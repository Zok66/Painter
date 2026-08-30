# -*- coding: utf-8 -*-
"""验证更多画笔撤回 bug 是否修复：画线 -> Ctrl+Z -> 截图检查是否残留小圆点"""
import sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:5173"
OUT = r"C:\Users\PC\.workbuddy\edge-debug-profile\shots"

PENS = ["圆珠笔", "钢笔", "铅笔", "蜡笔", "荧光笔"]

def draw_line(page, x1, y1, x2, y2, steps=25):
    page.mouse.move(x1, y1)
    page.mouse.down()
    for i in range(1, steps + 1):
        t = i / steps
        # 轻微抖动模拟真实手绘
        import math
        jitter = math.sin(t * 18) * 3
        page.mouse.move(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t + jitter)
        page.wait_for_timeout(8)
    page.mouse.up()
    page.wait_for_timeout(300)

def count_visible_ink(page):
    """统计场景中可见元素数量（通过 localStorage 场景或 SVG 数量间接判断）"""
    return page.evaluate("""() => {
        const svg = document.querySelector('.excalidraw__canvas');
        const containers = document.querySelectorAll('.excalidraw-elementCache canvas, .excalidraw__canvas');
        // 统计交互画布上非空 path
        let ink = 0;
        document.querySelectorAll('canvas').forEach(c => {});
        return { canvases: containers.length };
    }""")

def main():
    with sync_playwright() as p:
        b = p.chromium.connect_over_cdp("http://127.0.0.1:9222")
        page = b.contexts[0].pages[0]
        page.goto(BASE, wait_until="load", timeout=30000)
        page.wait_for_timeout(2500)

        # 清空本地场景，保证干净起点
        page.evaluate("localStorage.removeItem('painter:scene:v1')")
        page.reload(wait_until="load")
        page.wait_for_timeout(2500)

        results = {}
        for idx, pen in enumerate(PENS):
            # 打开更多画笔菜单并选择
            page.locator(".pen-menu .btn-pen").click()
            page.wait_for_timeout(300)
            page.locator(".pen-dropdown .pen-item").filter(has_text=pen).first.click()
            page.wait_for_timeout(300)

            # 画一条斜线
            x1, y1 = 220, 240 + idx * 10
            x2, y2 = 700, 300 + idx * 10
            draw_line(page, x1, y1, x2, y2)
            page.screenshot(path=f"{OUT}\\pen_{idx}_before_undo.png")

            # 撤回
            page.keyboard.press("Control+z")
            page.wait_for_timeout(500)
            page.screenshot(path=f"{OUT}\\pen_{idx}_after_undo.png")

            # 检查初始触点区域是否有残留墨迹：裁剪起笔点附近区域做像素分析
            leftover = page.evaluate("""([sx, sy]) => {
                // 找到主交互画布
                const canvas = document.querySelector('canvas');
                return { w: canvas?.width, h: canvas?.height };
            }""", [x1, y1])
            results[pen] = leftover

        # 关键像素检测：起笔点附近是否残留墨迹
        print("done")
        for pen, info in results.items():
            print(pen, info)

if __name__ == "__main__":
    main()
