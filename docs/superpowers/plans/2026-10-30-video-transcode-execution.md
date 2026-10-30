# Video Transcode — 实施记录（2026-10-30）

用户授权：A+B（现有素材批量处理 + 后续上传自动转码），本轮沿用 Native 执行。

## 已实现
- `VideoTranscoderService`：本地 MP4/MOV 上传达到 1,500,000 bytes 时尝试 H.264/AAC、最大 1280×720、≤30fps、CRF26、2Mbps 峰值、faststart；不放大源尺寸、不改比例。
- 每进程最多两个编码器，每个编码器单线程、90s 超时；失败/忙碌/结果变大保留原件，不使上传失败。
- MIME/扩展随成功转码结果对应；WebM、小视频、R2 presign 直传不在本轮自动转码范围。
- 前台只改视频请求 URL 加 `video=stream-v1`，绕过以前一年 immutable 缓存；数据库 URL、页面布局及播放交互保持不变。
- Docker backend 自带 ffmpeg，操作开关记在 backend/.env.example。
- 批处理工具 `backend/scripts/video-batch.cjs`：stage 先备份到公开 uploads 之外，按 SHA 去重转码；校验时长/音频/H.264/720p/faststart并完整解码；apply 验证原文件 SHA 未改变后同卷原子替换；restore 可按 manifest 恢复。

## 证据与裁决
- 上传服务的“更大结果应保留原件”测试 RED→GREEN；Nest 注入由 type-only token 引起的真实错误 RED→GREEN。
- 实际 ffmpeg 生成 1080p 测试片，转换为 720p 后完整解码成功、AAC 存在、moov 在 mdat 前。
- 新增 Cache 版本 helper RED→GREEN；相关前端 30 文件/321 用例通过。
- 合并生产 09d0d54 后后端全量 177 文件/2434 用例通过；22 文件/248 数据库用例跳过（没有运行生产数据库测试）。
- 后端 `nest build` 成功；全目录 `tsc --noEmit` 存在既有测试类型问题（auth/catalog/marketing/qianyi 等，uploads/config 无报错），不能报告为全量 tsc 通过。
- 批处理工具的安全判定测试 2/2 通过。
- 17 个生产视频共208,326,999 bytes，SHA 确认仅6份不同内容；一份20,183,958 bytes 的视频 moov 在文件尾。
- **Ruling:** 先前按文件大小推断固定起播耗时无充分证据，撤回该推断；以实际 bytes、Range、moov 和浏览器可播时间验收，不承诺所有网络1–3秒。
- **Ruling:** 原方案“原地覆盖+URL完全不变”会命中一年旧缓存；增加前台查询版本参数，不改DB素材地址。代价：本轮需一并重建前端。
- **Ruling:** 不把原片备份放到公开 `/uploads/originals`；用私有宿主机目录挂载，防止备份被外网直读。

## 发布前与生产验收
- [x] 前端合并后全量测试、前后端 production build。
- [x] 服务器现场基线核对，保存前后端镜像回滚标签；构建新镜像。
- [x] stage处理17个视频，审阅manifest，确认无截断且尺寸下降。
- [x] apply原子替换；切换后端自动上传与前端缓存版本；无新增迁移、不改商品/订单/客户记录。
- [x] 真实API上传测试（只生成测试素材不绑定商品）+ Range206+浏览器播放。
- [x] 记录实际压缩数据、跳过范围和回滚路径，见下文。

## 生产发布结果（2026-10-30）

- 部署代码：`51f04bec9d3288539bfbd5544138d3b4de625dac`；其后本文件的验收记录提交仅改文档。
- 服务器分支：`staging/luwag-shop-domain`，发布前基线 `09d0d54`。先合并真实生产基线，保留期间已上线的订单等修复，没有以落后的 GitHub main 覆盖生产。
- 新后端镜像：`sha256:ac972521fea17ff23f89605cd65c0932f3f0e5a9e05dd4d1c3adebb16653c9d7`。
- 新前端镜像：`sha256:35a76e0c24e86be512dce644eca658ebcda16ff220b0c230cabd26e04e866e2f`。
- 构建并依次切换 backend/frontend；均为 `running healthy`。Compose 全程显式使用 `--env-file .env.deploy`，切换使用 `--no-deps --wait`，未重建 DB/Caddy。
- 后端入口运行既有 `prisma migrate deploy` 检查，结果 `No pending migrations to apply`，本轮没有新增或应用迁移、没有运行 seed。
- 后端 ffmpeg：Debian 5.1.9。切换后检查前后端日志，未检出 ERROR/Error、依赖注入失败或转码失败。

### 现有视频 A：17/17 已替换并保留原片

总计 **208,326,999 → 11,713,682 bytes，减少 94.38%**。17 个路径实际包含 6 种不同内容，按源 SHA 去重编码，但每一个原路径均有独立原片备份。

| 内容代表文件 | 路径数 | 单文件原始 bytes | 单文件优化后 bytes | 尺寸变化 |
| --- | ---: | ---: | ---: | --- |
| `fd45438f-4bbb-471c-a22a-f40362f6292b.mp4` | 3 | 23,245,729 | 554,671 | 3840×2160 → 1280×720 |
| `e65bb3df-9beb-47ba-ac14-447096902336.mp4` | 9 | 11,651,047 | 315,952 | 2048×768 → 1280×480 |
| `6dcec326-885a-4b03-9a70-7073d2250c2d.mp4` | 1 | 20,183,958 | 1,777,332 | 1080×1080 → 720×720 |
| `b6751a61-1e2c-4953-96ef-8c6424989888.mp4` | 2 | 3,263,502 | 1,166,591 | 768×432 不变 |
| `cee08411-6f1b-473b-bafc-98ab9d65c10a.mp4` | 1 | 4,211,929 | 1,755,918 | 1080×1080 → 720×720 |
| `0a62af21-31b1-4ce5-b552-18beed5894af.mp4` | 1 | 2,807,498 | 1,339,669 | 720×1200 → 432×720 |

- 每种候选均经 ffprobe 时长/音轨/编码/尺寸校验、faststart 检查和完整解码后才 apply；时长最大差异 0.024 秒，未丢弃原来存在的音轨。
- apply 同卷原子替换并验证哈希，manifest 17 个条目全部 `APPLIED`。
- 部署后再次核对线上文件及私有原片备份：**34/34 SHA256 校验通过**。
- 外网对 17 个版本化 URL 分别请求 `Range: bytes=0-0`：**17/17 HTTP206**，Content-Range 总长度匹配新文件，Content-Type 均为 `video/mp4`。
- 浏览器确认真实页面的 `currentSrc` 带 `video=stream-v1`，而 `data-video-source` 和数据库素材路径仍为原路径。

### 后续上传 B：真实 API 已验收

- 在生产 backend 容器内用既有 `@nestjs/jwt` 签短时令牌，仅存内存；先经只读后台 API 确认鉴权可用，再调用正常 `POST /api/v1/admin/uploads`。
- 首个 3 秒测试片只有 1,175,115 bytes，未达到 1,500,000 bytes 的验收门槛，脚本在上传前拒绝；调整为 6 秒测试片后通过。这不是线上上传失败。
- 6 秒 H.264/AAC 测试片 **2,348,526 → 140,191 bytes**，API HTTP201，上传和编码共 **2,433ms**；输出 1280×720 H.264，AAC 保留，时长 6.014 秒。
- 测试素材未绑定商品、未创建订单；测试文件和生成素材的临时目录已在 finally 中删除。
- 适用范围：普通本地上传路径的 MP4/MOV 且 ≥1,500,000 bytes；WebM、小视频、R2 presign 直传不在自动编码范围。编码器忙碌、超时、缺失、失败或结果不比原片小时，继续保存原片。
- 这是有损的网页播放优化，最大框为 1280×720（竖屏为等比约束后的尺寸）；不保证每个视频具有相同压缩率，也不保证任意网络都在固定秒数内起播。后续新上传成功转码时保存优化成品，不另存一份原上传文件，上传者应自行保留母版。

### 浏览器与页面回归

同一 Chrome 隔离上下文 `video-acceptance-20261030`、同一商品页、Slow 4G、静音播放，每次加新的 acceptance 查询值避免命中旧 URL 缓存，记录从设置 src/load/play 到 `playing` 事件（不是全文件下载耗时）：

| 视频 | 优化前起播 | 优化后起播 | 优化前 metadata | 优化后 metadata |
| --- | ---: | ---: | ---: | ---: |
| 23.25MB / 4K / 8.72s | 6,391ms | 1,796ms | 3,837ms | 979ms |
| 2.81MB / 竖屏 / 23.23s | 1,573ms | 1,260ms | 1,392ms | 1,238ms |

- 两个样本均能播放，无媒体错误；竖屏片段 seek 到 2s 后 `readyState=4`，截图确认有实际画面。
- 以上为此浏览器的单次受控样本，不是菲律宾用户网络分位数，也不是全站统一 SLA。
- 额外只读 HTTP 烟测：首页、About、All Products、购物车、结账、订单查询、Contact、Returns 均 HTTP200、完整 HTML。
- 已上线图片优化未退化：抽查 Next image 优化器 HTTP200、`image/webp`、13,248 bytes；浏览器商品图使用优化 URL 并加载成功。
- 不创建真实订单、不提交订阅、不更改客户账号；页面浏览可能产生既有第一方访问统计，不能把“未改业务记录”写成“数据库绝对零变化”。

### 测试与已知验证边界

- 发布前前端全量：**309 文件 / 3435 用例通过**。
- 发布前后端全量：**177 文件 / 2434 用例通过**，**22 文件 / 248 数据库用例跳过**，没有连接生产 DB 跑测试。
- 后端定向上传+环境校验 **38/38**、批处理安全检查 **2/2**；真实 ffmpeg 集成测试有实际执行，不是缺二进制后 skip。
- 前后端生产构建通过；前端 `tsc --noEmit` 通过。
- 后端全目录 `tsc --noEmit` 的既有测试类型问题仍在，不能宣称后端全目录类型检查全绿；新文件 Prettier check 曾有格式警告，不能宣称所有格式检查通过。
- 没有在本轮运行真实下单 E2E、发送邮件或启用 ERP。

## 备份与恢复

- 私有宿主机目录：`/var/backups/luwag/video-20261030T033159Z/`（权限 0700，不在公开 uploads 路由内）。
- `manifest.json` 包含每一路径原/新 SHA256、时长、音轨、大小与状态；`originals/` 保留 17 份原片，`candidates/` 保留 6 份校验过的成品。请勿当作可清理的临时目录删除。
- 发布前后端回滚镜像：`small-house-prod-backend:rollback-pre-video-20261030T033159Z`，镜像 ID `sha256:7b61beeed1d00b64430c64f062538a5338662b3101a9de968928cf811096c7b2`。
- 发布前前端回滚镜像：`small-house-prod-frontend:rollback-pre-video-20261030T033159Z`，镜像 ID `sha256:336a0832fc1ca1bdc00292cf37630d5024622fa5a0d6d9f7c9e586cc43167ef3`。
- 只回退应用镜像不等于恢复视频字节；两者是独立恢复动作。恢复前必须重新检查当前生产基线，后续其他发布可能已前进，禁止盲退本次旧镜像覆盖别人的改动。

仅需恢复这 17 个原片时，在确认线上仍是 manifest 中的新 SHA 后运行（命令仅交接，未执行回滚）：

```sh
# 在服务器 /opt/small-house-commerce/small-house-commerce 下执行。
# --restore 会校验当前字节和原片 SHA，逐个原子恢复；不操作 DB。
docker run --rm --network none \
  --volumes-from small-house-prod-backend-1 \
  -v /var/backups/luwag/video-20261030T033159Z:/video-backup \
  -v /opt/small-house-commerce/small-house-commerce/backend/scripts:/video-tools:ro \
  --entrypoint node \
  small-house-prod-backend:video-20261030T033159Z \
  /video-tools/video-batch.cjs /app/uploads /video-backup --restore
```

恢复同路径资源后，已缓存优化文件的浏览器不会自动忘记一年 immutable 缓存；若恢复是为解决播放缺陷，应同步更换前端播放版本并按当前基线重新发布，而不是依赖用户清缓存。

## 后续热修：PDP 图集视频不播放与播放标常显（2026-10-30）

用户在 iPhone 上反馈点击商品主图进入图集后，视频黑屏、时长 00:00；主图预览实际正在播放时中央 ▶ 仍一直显示。

- 复现：生产页面点开图集的视频被设为 `preload="none"`，进入时不会加载也不开始播放；手动按原生播放键后同一文件可正常播放到 23.234 秒、432×720。主图播放标是独立叠层，没有跟播放状态联动。
- 修复：仅改动前台图集组件与视频封装。打开图集的当前视频改为 `preload="metadata"` 并静音自动起播，保留原生播放/声音控件；手机竖排图集只自动播放用户点开的那一支，其他视频滑到可见才播放、离开视口暂停；主图播放标在 `playing` 后隐藏，`pause`/`ended`/`error` 后恢复，缩略图仍保留播放标。未改页面布局、文案、导航或后台。
- 证据：先写测试并确认 7 项按预期失败，再实现后转绿；前端全量 **309 文件 / 3440 用例**、`tsc --noEmit`、改动文件 eslint、production build 全部通过。
- 发布：提交 `9b39274b38e5b72740f773e22e742769f6edb4c0`，生产基线 `51f04be` 之后 fast-forward；仅重建并切换 frontend，backend 保持视频发布镜像 `ac972521`。新前端镜像 `sha256:940ff017ba5de8f575bef798240402967c31238070c26d612067c7bd6994a83a`，回滚标签 `small-house-prod-frontend:rollback-pre-pdp-video-20261030`（指向 `sha256:35a76e0c`，即视频发布后的前一版前端）。
- 生产验收：iPhone 13 WebKit 与手机 Chromium 均确认打开图集视频自动播放、有原生控件、23.234 秒、无页面错误、关图集后主图续播；桌面 1440 Chromium 的 split 视图视频同样可播；主图播放时播放标隐藏。8 个主要页面 HTTP200，视频仍 HTTP206。

## 无关附带改动

**无新增无关附带改动。** 本轮仅视频编码、运行镜像所需 ffmpeg、视频请求缓存版本及图集视频播放控制、测试/运维脚本、文档；没有改 Header/Footer/导航/页面版式、按钮样式、售价、商品关联素材 URL、订单或客户数据。合并生产基线只是保留已在线的其他功能，不是本轮另行发布设计调整。
