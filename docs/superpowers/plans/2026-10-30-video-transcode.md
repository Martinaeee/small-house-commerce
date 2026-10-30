# Video Transcode Implementation Plan (Part B) + One-off Transcode (Part A)

> **历史草案，已被实际实施与生产验收记录取代。** 当前状态和恢复步骤以 [2026-10-30-video-transcode-execution.md](2026-10-30-video-transcode-execution.md) 为准。不要执行下文旧 shell 方案：正式版本采用最大 1280×720、私有原片备份、校验后原子替换及前台缓存版本，不把原片放在公开 uploads 下；自动转码并非覆盖所有格式/存储路径，也没有“所有网络 1–3 秒起播”的承诺。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, chosen pattern of this session). Steps use checkbox syntax.

**Goal:** 商品/落地页视频上传自动转码为 H.264 WebP-era mp4（≤1080p、faststart、CRF26），并对现有 17 个未压缩视频（~199MB，最高 23MB）做一次性批量转码，目标买家起播 1–3 秒。

**Architecture:** 新 `VideoTranscoderService`（Node spawn ffmpeg，临时文件进出，任何失败/超时**回退原图字节**，绝不 500 上传）；`UploadsService.saveLocal` 在保存前调用（两处上传入口都经此，全覆盖）；webm 直接跳过（vp9 已高效）；backend Dockerfile via apt 装 ffmpeg。Part A 复用同一 ffmpeg 在生产容器里对 uploads 卷做原地转码（原片备份 `uploads/originals/`），URL 不变、前端零改动。

**Spec:** 用户 2026-10-29 拍板「A + B」（会话内）；图片轻量化已上线（见 store史 memory)，视频是其明确遗留边界。

## Global Constraints

- 失败安全：转码任何异常 → 存原始文件并 console.warn，上传接口 200 不变。
- URL/DB 兼容：Part A 不改文件名（全部是 .mp4）；Part B 仅对 mov 输入把落盘扩展改为 mp4（记录在其后创建，无陈旧引用）。
- 生产部署须 `--env-file .env.deploy`；backend 重建会有 ~10–20s API 空窗（既有常规）。
- Prisma 无迁移（schema 不动）；`pnpm build` 前必须 `prisma generate`（容器构建流程已含）。

---

### Task 1: VideoTranscoderService（TDD）

**Files:**
- Create: `backend/src/modules/uploads/video-transcoder.service.ts`
- Create: `backend/src/modules/uploads/video-transcoder.service.spec.ts`
- Modify: `backend/src/modules/uploads/uploads.module.ts`（provider）

**Interfaces:**
- Produces: `transcode(buffer: Buffer, contentType: string): Promise<{ buffer: Buffer; contentType: 'video/mp4' } | null>`（null = 跳过；内部失败也返回 null）
- Consumes: ConfigService（`upload.ffmpegPath`，默认 `ffmpeg`；`upload.videoTranscode` 默认 true；`upload.videoTranscodeTimeoutMs` 默认 90000）

- [ ] RED1: 无 ffmpeg 二进制路径（指向 /bin/false）→ 返回 null，不抛错。
- [ ] RED2: webm → null（跳过）。
- [ ] GREEN: 用 `FFMPEG_PATH` env 指向本机 `/Users/Admin1/Downloads/ffmpeg-static/ffmpeg`（本机无 brew，用 ffmpeg-static 下载的 6.0 arm64 二进制；测试文件 beforeAll 用它生成 2 秒测试片），h264 mp4 输出、faststart flag 存在（ffprobe/`-h` 检查不了 faststart——以输出文件可解码 + 尺寸缩小为准）。
- [ ] RED3: 输入 >1.5MB 的 mp4 → 输出为更小的 mp4 buffer（本机 ffmpeg 可用才跑，否则 skip 并 console.warn——生产 greenhouse 由容器 ffmpeg 兜底）。
- [ ] 超时：假 binary `sleep 5` 脚本 + timeoutMs=300 → null。

### Task 2: wire saveLocal + spec

**Files:**
- Modify: `backend/src/modules/uploads/uploads.service.ts`（saveLocal 注入 transcoder；≥1.5MB mp4/mov 尝试，转码结果更小才采用；扩展名按最终 contentType）
- Modify: `backend/src/modules/uploads/uploads.service.spec.ts`（新增两条：转码成功写入更小的字节数 + 同 URL key 扩展规则；fallback 写原字节）
- Modify: `backend/.env.example`? 若存在则补 `UPLOAD_FFMPEG_PATH`/`UPLOAD_VIDEO_TRANSCODE=on|off`（查看 ./config/env.validation.ts 命名约定后再定 env 名，遵循现有风格）

### Task 3: 生产容器带 ffmpeg

**Files:**
- Modify: `backend/Dockerfile`（base 阶段加 `RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*`，build/runner 均继承）

**验证:** docker 不在本机——以服务器构建为准（Task 5）。本机验证改用「net build + service 单测」+ 在服务器 build 后 `docker run --rm image ffmpeg -version`。

### Task 4: 全量验证

- backend 全测试（vitest）；tsc；前端不感知（无接口变化）。
- 本地 dev 起 backend（mac 无 ffmpeg 自动 fallback，不影响其它上传）+ 用 FFMPEG_PATH 指向本地二进制实测一次保存转码（可选，若 dev 环境复杂则跳过走生产烟测）。

### Task 5: 部署 + Part A 批量转码（用户已授权 A+B）

- [ ] 服务器核对基线（fetch 服务器 remote，防并行推进）→ merge → 构建 backend 镜像（`--env-file .env.deploy`）→ `docker run --rm <img> ffmpeg -version` → `up -d backend && up -d frontend?`（仅 backend）。
- [ ] Part A 脚本（docker exec backend）：
  ```sh
  mkdir -p /app/uploads/originals
  for f in $(find /app/uploads -name '*.mp4' ! -path '/app/uploads/originals/*'); do
    cp "$f" "/app/uploads/originals/$(basename $f)"
    ffmpeg -hide_banner -loglevel error -y -i "$f" \
      -vf "scale='min(iw,1920)':'min(ih,1080)':force_original_aspect_ratio=decrease:force_divisible_by=2" \
      -c:v libx264 -preset veryfast -crf 26 -c:a aac -b:a 96k -movflags +faststart -pix_fmt yuv420p \
      "/tmp/$(basename $f).out" && mv "/tmp/$(basename $f).out" "$f"
  done
  ```
- [ ] 逐文件核验：ffprobe 时长差 ≤10%；体积下降；输出存在。
- [ ] 生产烟测：PDP `stainless-movable-double-layer-clothes-rack` 的 2.8MB 视频 URL 重测 content-length；Range 206 仍在；前端播放（浏览器打开 PDP 播放视频）。
- [ ] 失败回滚：`cp /app/uploads/originals/* 对应目录`；backend 回退镜像 rollback 标签。

---

## Self-Review

- Spec 覆盖：A（原地转码+备份+烟测）= Task 5；B（服务+接线+容器）= Task 1-3；防护（fallback/超时/webm 跳过）= Task 1。
- 无占位符；接口单点 `transcode()`；宽度定 96/640/1280/1440 类比无遗留。
- Review Focus 转化为测试：RED1/2/3 + 超时 + saveLocal 两条。
- 风险：生产 backend 重建空窗 ~10-20s（低峰执行）；转码期间 CPU 单核占满（veryfast，17 文件串行 ~3-8 分钟，一次性）。
