# 润笔 (Runbi) - 视觉资产与 Logo 图标规范

---

## 1. 资产文件清单与使用场景

所有视觉源文件已整理归档在工程根目录的 `assets/` 文件夹中：

| 资产文件 | 文件名 | 适用场景 | 说明 |
| :--- | :--- | :--- | :--- |
| **品牌主标 (Brand Logo)** | [`assets/logo_brand.jpg`](../assets/logo_brand.jpg) | 官网、GitHub README 顶部、关于我们弹窗、宣传物料 | 包含“Runbi 润笔”标准字体与“灵笔掠水”图形组合 |
| **应用主图标 (App Icon)** | [`assets/icon_app.jpg`](../assets/icon_app.jpg) | 浏览器扩展图标、Chrome Web Store 头像、桌面端托盘 | macOS Squircle 质感，深墨绿底座 + 磨砂金笔尖 + 晶莹露珠 |
| **划词概念图 (Concept)** | [`assets/icon_concept.jpg`](../assets/icon_concept.jpg) | 官网特性展示、安装引导页背景、功能宣传图 | 展现笔尖划过文字激起青色流光与星芒粒子的动态意象 |

---

## 2. Chrome Extension 图标尺寸与切图要求

Chrome 扩展 Manifest V3 在 `manifest.json` 中需要配置以下尺寸的 PNG 图标（建议以 `assets/icon_app.jpg` 为基准裁切与压缩）：

```json
{
  "icons": {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  },
  "action": {
    "default_icon": {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png"
    }
  }
}
```

### 尺寸对应说明：
- **16x16 px**：显示在标签页 Favicon、扩展下拉菜单等极小尺寸下，需保证笔尖轮廓清晰。
- **32x32 px**：Windows 视网膜高分屏下的工具栏展示。
- **48x48 px**：显示在 `chrome://extensions` 扩展管理中心页面。
- **128x128 px**：Chrome 网上应用店 (Web Store) 列表页及安装时的对话框展示。

---

## 3. 一键切图辅助脚本 (Python / Sharp)

接手的 AI 或开发者可运行如下 Python 脚本，自动从 `assets/icon_app.jpg` 导出符合规范的各尺寸 PNG 图标：

```python
# scripts/generate_icons.py
from PIL import Image
import os

source_icon = "assets/icon_app.jpg"
output_dir = "public/icons"
sizes = [16, 32, 48, 128]

os.makedirs(output_dir, exist_ok=True)
img = Image.open(source_icon)

for size in sizes:
    resized = img.resize((size, size), Image.Resampling.LANCZOS)
    resized.save(f"{output_dir}/icon-{size}.png", "PNG")
    print(f"Generated: {output_dir}/icon-{size}.png")

print("All Chrome Extension icons generated successfully!")
```

---

## 4. 品牌色彩与设计哲学 (Design Philosophy)

- **“润”**：水是万物之源，亦是文学润色的灵魂。图标中的水滴采用高透微光材质，UI 中的高亮线条采用翡翠玉青（`#00BFA5`），象征为干瘪词句注入生命力。
- **“笔”**：笔是思考的延伸。采用香槟金与微磨砂质感的修长笔尖，传递出沉稳、专业、克制与值得信赖的工具质感。
- **“光”**：划词交互时伴随轻柔的流光扫过，让用户的写作与修改过程充满掌控感与愉悦感。
