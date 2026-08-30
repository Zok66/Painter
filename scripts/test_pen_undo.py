# -*- coding: utf-8 -*-
"""
验证「更多画笔」撤回不留残留：画线 -> Ctrl+Z -> 起笔点区域做像素检查。

复现的 bug：撤回后整条线消失，但初始触点会留下一个小圆点
（根因是预览元素 version 不递增 + Store 快照，见 commit d1f4b81）。

用法：
  1. 启动 dev server：npx vite --port 5173
  2. 启动 Edge 并开远程调试：
     "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
       --remote-debugging-port=9222
       --user-data-dir="C:/Users/PC/.workbuddy/edge-debug-profile"
  3. 运行：python scripts/test_pen_undo.py

判定：撤回后起笔点区域的深色像素应回到 0。
"""
import math
import os

from PIL import Image
from playwright.sync_api import sync_playwright

BASE = "http://localhost:5173"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "test_out")

PENS = ["圆珠笔", "钢笔", "铅笔", "蜡笔", "荧光笔"]


def dark_ratio(path, box):
    """统计指定框内深色像素（墨迹）占比"""
    im = Image.open(path).convert("RGB")
    px = im.load()
    x0, y0, x1, y1 = box
    hit = 0
    total = 0
    for y in range(y0, y1, 2):
        for x in range(x0, x1, 2):
            total += 1
            r, g, b = px[x, y]
            if r < 180 and g < 180 and b < 180:
                hit += 1
    return hit / total * 100 if total else 0.0


def draw_line(page, x1, y1, x2, y2, steps=25):
    page.mouse.move(x1, y1)
    page.mouse.down()
    for i in range(1, steps + 1):
        t = i / steps
        jitter = math.sin(t * 18) * 3  # 轻微抖动模拟真实手绘
        page.mouse.move(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t + jitter)
        page.wait_for_timeout(8)
    page.mouse.up()
    page.wait_for_timeout(300)


def main():
    os.makedirs(OUT, exist_ok=True)
    failed = []

    with sync_playwright() as p:
        b = p.chromium.connect_over_cdp("http://127.0.0.1:9222")
        page = b.contexts[0].pages[0]
        page.goto(BASE, wait_until="load", timeout=30000)
        page.wait_for_timeout(2500)

        # 清空本地场景，保证干净起点
        page.evaluate("localStorage.removeItem('painter:scene:v1')")
        page.reload(wait_until="load")
        page.wait_for_timeout(2500)

        for idx, pen in enumerate(PENS):
            # 打开更多画笔菜单并选择
            page.locator(".pen-menu .btn-pen").click()
            page.wait_for_timeout(250)
            page.locator(".pen-dropdown .pen-item").filter(has_text=pen).first.click()
            page.wait_for_timeout(500)

            # 画一条斜线
            x1, y1 = 320, 240 + idx * 80
            x2, y2 = 800, 300 + idx * 80
            draw_line(page, x1, y1, x2, y2)
            before = os.path.join(OUT, f"pen_{idx}_before.png")
            page.screenshot(path=before)

            # 撤回
            page.keyboard.press("Control+z")
            page.wait_for_timeout(600)
            after = os.path.join(OUT, f"pen_{idx}_after.png")
            page.screenshot(path=after)

            # 检查起笔点附近是否残留墨迹（小圆点就出在这里）
            box = (x1 - 30, y1 - 40, x1 + 90, y1 + 40)
            pct = dark_ratio(after, box)
            ok = pct < 0.2
            print(f"{pen}: 撤回后起笔点区域墨迹 {pct:.2f}% -> {'OK' if ok else 'FAIL'}")
            if not ok:
                failed.append(pen)

        print()
        if failed:
            print("FAILED:", "、".join(failed))
            raise SystemExit(1)
        print("ALL PASSED: 五种笔撤回后均无残留")


if __name__ == "__main__":
    main()
