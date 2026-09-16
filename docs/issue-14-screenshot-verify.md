# Issue #14 测试-截图功能验证 (run_id=dfe7dfc4)

## User Journey
- User outcome: 确认派活台截图已上传到服务器，并测试 AI worker 能否读图分析。
- Preconditions: 截图上传至 /opt/orbi/uploads/。
- Acceptance: AI worker 能读图并给出内容分析。
- Failure path（实际发生）: 服务器上不存在 `shot1.png`
  （错误: `cannot open '/opt/orbi/uploads/shot1.png' (No such file or directory)`）。

## 证据（2026-09-16）
- `/opt/orbi/uploads/20260916-114930-0.png` 存在，但仅为 8x8 像素 RGBA PNG（81 bytes 占位文件，非真实截图）。
- AI worker 读图（read 工具）返回:
  `Current model does not support images. The image will be omitted from this request.` — 当前模型不支持图像输入，无法读图。

## 结论
测试失败。原因:
1. `shot1.png` 不存在（Issue 文件名与实际上传文件名不一致，对应实际文件为 `20260916-114930-0.png`）。
2. 即使读取对应文件，它只是占位 PNG，无有效内容。
3. AI worker 当前模型不支持图像输入。

## 建议
- 上传侧需以 `shot1.png` 命名落盘（或 Issue 注明真实文件名）。
- 派活台需上传真实截图（当前为 8x8 占位图）。
- AI worker 需切换到支持图像输入的模型才能读图分析。

本 Issue 为验证任务，无代码改动。
