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
- [ ] 前端合并后全量测试、前后端 production build。
- [ ] 服务器现场基线核对，保存前后端镜像回滚标签；构建新镜像。
- [ ] stage处理17个视频，审阅manifest，确认无截断且尺寸下降。
- [ ] apply原子替换；切换后端自动上传与前端缓存版本；不迁移、不改业务数据。
- [ ] 真实API上传测试（只生成测试素材不绑定商品）+ Range206+浏览器播放。
- [ ] 汇报实际压缩数据、跳过范围和回滚路径。
