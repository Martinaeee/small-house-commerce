# PSGC 地址下拉 + 定位 + 地图（E 批）设计

> 参考：2026-09-16 功能盘点审计 §11 批次 E「PSGC 搜索式地址下拉 + checkout 定位 + Google 地图」；已定决策：定位仅 checkout 地址步按钮触发（2026-09-15 站内定位决策）；B 批 ETA（省名 "Metro Manila" 恰为 PSGC 省名，NCR 判定零改动兼容）；D 批（checkout 表单含 preferredDeliveryDate 字段，E 批表单改造须保留）。分支：`feat/psgc-address`（叠于 D 批 feat/preferred-delivery-date）。日期：2026-09-17。

## 1. 背景与目标

checkout 省/市/Barangay 目前是自由文本（易错、无法级联、配送难定位）。本批换成 PSGC 三级可搜索下拉（省→市/县→Barangay）、加「Use my location」按钮（Nominatim 逆地理免 key）、确认页地址卡嵌入免 key Google Maps iframe。

**用户拍板的决策**：
- **全级联含 Barangay**：省/市/县数据（~120KB）打包进前端；Barangay（4.3MB）由**后端新静态数据端点按市过滤**提供。
- **确认页嵌入 Google Maps**（`maps.google.com/maps?q=...&output=embed` 免 key iframe）。
- **按钮定位填省/市**（Barangay 可解析也填，街道手填；拒绝/失败仅提示不阻塞）。

## 2. 全局约束

- **零新 npm 依赖**：PSGC 数据以静态 JSON 文件提交（数据文件不是依赖）。来源：npm `psgc@2.2.0`（MIT，© 2021 Patrick Ofilada）——数据快照 2021，须随包携带 MIT 许可声明（`NOTICE` 文件或数据目录内 LICENSE），spec 注明刷新路径（官方 PSGC 季度更新，上线前可换新快照）。
- 数据结构（已实证）：
  - `regions.json`：`[{name, designation}]`（17 项）
  - `provinces.json`：`[{name, region}]`（85 项；**"Metro Manila" 的 region 是 "NCR"**）
  - `municipalities.json`：`[{name, province, city}]`（1634 项）
  - `barangays.json`：`[{code, name, citymun}]`（42036 项；`citymun` = 市/县**名称**，非 code）
- 表单值仍是**名称字符串**（province="Metro Manila" 等）——后端订单 DTO 与校验**零改动**（B/D 批已兼容）；B 批 `isMetroManila` 别名集已含 "metro manila"，ETA 判定**零改动**。
- `frontend/src/lib/api.ts` 禁止修改 → 新增 `frontend/src/lib/psgc.ts`（数据加载 + 级联查询 + 定位辅助）。
- 后端新模块 `psgc`：仅静态数据读取（fs），**无 DB、无迁移**；控制器 `storefront/psgc`，无 guard。
- 外部服务（Nominatim/Google Maps iframe）仅在客户端调用/渲染；**失败必须静默或行内提示，绝不阻塞下单**。
- 冻结 COD 文案/新文案英文；Meta Pixel 零新增（定位/地图不触发 track）。
- 线 A 通知：checkout 表单/确认页为线 B 自有（B/D 批已改），无线 A 共享文件改动——仍按惯例通知（表单是两线整合面）。

## 3. 功能规格

### 3.1 数据落地

- **前端** `frontend/src/data/psgc/`：`regions.json`、`provinces.json`、`municipalities.json` + `LICENSE`（MIT 全文 + 出处 + 2021 快照说明）。数据经 tarball 提取后以**最小化字段**提交（provinces/municipalities 只留所需字段，体积 < 130KB）。
- **后端** `backend/src/assets/psgc-barangays.json`（4.3MB 原样或压缩字段：code/name/citymun）+ 同目录 `LICENSE`。

### 3.2 后端端点

**GET `/api/v1/storefront/psgc/barangays?city=<名称>`**（无鉴权）：
- 模块级加载一次（`fs.readFileSync` + JSON.parse，启动时 ~50ms）；按 `citymun === city` 过滤（精确匹配，名称规范化 trim）。
- 返回 `{ city, barangays: [{ code, name }] }`；城市无匹配 → `[]`（200，非 404——前端据此显示「未找到」）；`city` 缺失/超长 → 400 Zod。

### 3.3 前端级联选择（checkout 表单）

- 新客户端组件 `frontend/src/components/checkout/PsgcAddressSelects.tsx`（受控，props 与现有字段一致：`value/onChange/onBlur/errors/inputCls` 风格；内部三组可搜索下拉）：
  1. **Province**：从打包数据过滤出非重复省名（按 region 分组可选展示 `Metro Manila (NCR)`——展示名含 region 后缀或仅名称，裁定仅名称、省列表按 region 排序）；可搜索（本地 filter，输入即过滤）。
  2. **City/Municipality**：按所选省过滤（`province === selectedProvince`）；不可选省时禁用。
  3. **Barangay**：选市后 `GET /storefront/psgc/barangays?city=...` 拉取（按市缓存 Map）；加载中显示 `Loading…`；失败显示行内提示并可重试，**不阻塞**（barangay 本就可选填——现有字段 optional）。
- 实现形态：轻量 combobox（`<input>` + 过滤后的 `<ul role="listbox">` 或原生 `<select>` + 搜索输入）。**裁定用原生 `<select>` + 独立搜索输入过滤**（零依赖、可访问性好、实现稳）；省市数据量小（≤85/≤1634 按省过滤后更少）下拉即可，Barangay 按市 ≤ 数百项用可搜索 select。
- 值回写表单 state（名称字符串），与现有 `form.province/city/barangay` 完全一致；`onBlur` 触发现有 `revalidate`。
- **兼容 D 批**：只替换 Province/City/Barangay 三个字段的实现（B 批的 privacy note 位置、D 批的 preferredDeliveryDate 字段保留不动）。
- **NCR/ETA**：省名 "Metro Manila" 直接命中 B 批别名——ETA/保障条/COD 卡行为不变。

### 3.4 定位（checkout 地址卡）

- 「Use my location」按钮（`data-testid="use-my-location"`，定位图标 + 文案；放 Delivery Address 卡标题行右侧）。
- 点击 → `navigator.geolocation.getCurrentPosition`（仅此时申请权限，符合站内定位决策）→ `fetch https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=..&lon=..`（客户端直接调用，无 key；`Accept-Language: en`）：
  - 解析：`province`（省）或 `state` → 与 PSGC 省名规范化匹配（trim/小写/折叠空格）；`city`/`municipality`/`town` → 市匹配；`suburb`/`neighbourhood` → barangay 尽力匹配（不中留空）。
  - 只回填**置信匹配**的省/市（失败留空并提示可手选）；Barangay 命中才填。
  - 状态：按钮 loading（`Locating…`）；成功 → 回填 + 现有 revalidate；拒绝/超时/网络失败 → 行内提示 `Could not detect your location. Please select your province and city.`（`data-testid="location-error"`），**不阻塞下单**。
- 无 HTTPS/localhost 外环境 getCurrentPosition 不可用 → 同错误提示路径（dev localhost 可用）。

### 3.5 Google Maps 确认页嵌入

- `CheckoutConfirmView.tsx` 地址卡底部（有 streetAddress+city+province 时）：
```tsx
<iframe
  data-testid="confirm-map"
  title="Delivery location map"
  className="mt-3 h-48 w-full rounded-lg border border-border"
  loading="lazy"
  referrerPolicy="no-referrer-when-downgrade"
  src={`https://maps.google.com/maps?q=${encodeURIComponent(addressLine)}&output=embed`}
/>
```
- `addressLine = streetAddress, city, province`（不含 barangay/邮编，query 简洁性优先）。
- 免 key embed；加载失败由浏览器静默处理（白框）——接受，不额外做错误探测（iframe onError 不可靠）。

### 3.6 草稿兼容

- 表单字段仍是三个字符串 → `CheckoutDraftCustomer` 形状不变；D 批草稿回填机制原样工作。

## 4. 数据流

```
CheckoutForm
 ├─ PsgcAddressSelects：省（前端数据）→ 市（前端数据）→ barangay（后端端点按市过滤，Map 缓存）
 ├─ Use my location → geolocation → Nominatim 逆地理 → 置信回填省/市
 └─ 表单值 = 名称字符串（后端 DTO 零改动）
CheckoutConfirmView 地址卡底部 ← Google Maps iframe embed（免 key）
```

## 5. 验收

### 5.1 门禁

后端 `cd backend && pnpm build`；前端 tsc 0 错 / eslint 0/0 / `npm run build`。

### 5.2 浏览器/接口验收（:3003/:3004）

1. 数据：前端 3 个 JSON 可解析、省 85 项含 "Metro Manila"(NCR)；后端 barangays 端点按 "Quezon City" 过滤返回其 barangay 列表（条数正确、含 "Pob." 类型），未知市返回 `[]`，缺参 400。
2. 级联：选 "Metro Manila" → 市列表仅 NCR 市（Manila/Quezon City/Makati…）；选市 → barangay 可搜索加载；切换省 → 市/barangay 重置；直接手填历史值（草稿回填）仍可显示（值不在列表时 select 显示原文兜底——**裁定：value 不在选项集时渲染只读文本 + 可重选**）。
3. 定位：按钮点击出现权限询问（可授/拒）；授权后（测试用固定坐标 stub 或真实授权）省/市回填正确；拒绝 → 行内提示且不阻塞下单。
4. 地图：确认页地址卡含 iframe（src 含编码地址）；无地址不渲染。
5. 回归：B 批 ETA（Metro Manila → 工作日窗口）/保障条/隐私行；D 批日期字段与草稿；下单 payload（省名 "Metro Manila" 等）与后端校验兼容；冻结文案 grep；console 0 错误（地图 iframe 的跨域 console 噪音除外，注明）。
6. 无障碍：下拉可键盘操作（原生 select）、aria-label、焦点行为。
7. 无测试数据残留。

### 5.3 边界情况

- 历史订单/草稿含数据集外省市（如拼写变体）：兜底只读显示 + 可重选。
- Nominatim 限流/离线/跨域失败：行内提示，不阻塞。
- 定位精度差（返回 suburb 而非 city）：city 匹配失败 → 留空提示手选。
- 省名重复（PSGC 无重名省，市名跨省重复由省过滤消除）。
- 后端 barangays 文件缺失（部署遗漏）：端点 500 → 前端行内错误可重试，不阻塞。
- 移动端：select 原生控件行为良好；地图 iframe lazy。

## 6. 非目标

- 官方 PSGC 实时数据/自动更新（2021 快照，上线前可人工换新）、后端建表存 PSGC、逆地理街道级自动填充、地图 API key 版本、买家端地图交互（拖动选点）、行政区划变更实时同步。

## 7. 交付物清单

- 分支 `feat/psgc-address`（不合并）；数据文件 + LICENSE 一并提交。
- 执行前通知线 A（checkout 表单整合面；无共享文件改动）。
