# -*- coding: utf-8 -*-
"""
验证「保存含图片的画布 -> 清空 -> 打开刚才保存的文件」这条链路图片是否还在。

用法：先启动 dev server（npx vite --port 5173），再运行本脚本。
需要 Edge 已用 --remote-debugging-port=9222 启动。
"""
import os
from playwright.sync_api import sync_playwright

SHOTS = r"C:\Users\PC\.workbuddy\edge-debug-profile\shots"
HERE = os.path.dirname(os.path.abspath(__file__))
SEED = os.path.join(HERE, "test_assets", "seed_scene.json")
SAVED_DIR = os.path.join(SHOTS, "saved")
SAVED = os.path.join(SAVED_DIR, "scene.excalidraw")


def colorful_pixels(name, box):
    """统计指定区域内非白且非灰的彩色像素（用于判断图片是否真的渲染出来）"""
    from PIL import Image

    im = Image.open(os.path.join(SHOTS, name)).convert("RGB")
    px = im.load()
    x0, y0, x1, y1 = box
    hit = 0
    total = 0
    for y in range(y0, y1, 3):
        for x in range(x0, x1, 3):
            total += 1
            r, g, b = px[x, y]
            # 图片是红底(#ff6b6b)+黄椭圆(#ffd43b)+蓝方块(#1971c2)，都是饱和色
            if max(r, g, b) > 200 and (max(r, g, b) - min(r, g, b)) > 60:
                hit += 1
    return hit, total, f"{hit / total * 100:.2f}%"


def main():
    with sync_playwright() as p:
        b = p.chromium.connect_over_cdp("http://127.0.0.1:9222")
        page = b.contexts[0].pages[0]
        page.goto("http://localhost:5173", wait_until="load", timeout=30000)
        page.wait_for_timeout(2000)

        # 把带图片的场景写进 localStorage（等价于"画布上有一张图"）
        seed = open(SEED, "r", encoding="utf-8").read()
        page.evaluate(
            "raw => localStorage.setItem('painter:scene:v1', raw)",
            seed,
        )
        page.reload(wait_until="load")
        page.wait_for_timeout(2500)
        page.screenshot(path=os.path.join(SHOTS, "img1_with_image.png"))
        # 初始时图片在 (400,250)-(640,430)；打开后 scrollToContent 会居中放大
        print("1) 初始（有图）:", colorful_pixels("img1_with_image.png", (380, 230, 660, 450)))

        # 保存
        os.makedirs(SAVED_DIR, exist_ok=True)
        with page.expect_download() as dl:
            page.locator('button:has-text("保存")').first.click()
        dl.value.save_as(SAVED)
        size = os.path.getsize(SAVED) if os.path.exists(SAVED) else 0
        print("2) 保存文件:", size, "bytes")
        content = open(SAVED, "r", encoding="utf-8").read()
        print("   文件里含 files 二进制:", '"dataURL"' in content)

        # 清空
        page.once("dialog", lambda d: d.accept())
        page.locator('button:has-text("清空")').first.click()
        page.wait_for_timeout(800)
        page.screenshot(path=os.path.join(SHOTS, "img2_cleared.png"))
        print("3) 清空后:", colorful_pixels("img2_cleared.png", (380, 230, 660, 450)))

        # 打开刚才保存的文件
        with page.expect_file_chooser() as fc:
            page.locator('button:has-text("打开")').first.click()
        fc.value.set_files(SAVED)
        page.wait_for_timeout(1800)
        page.screenshot(path=os.path.join(SHOTS, "img3_reopened.png"))
        # 重新打开后 scrollToContent 居中放大，全屏搜彩色像素
        print("4) 重新打开:", colorful_pixels("img3_reopened.png", (200, 150, 1100, 600)))


if __name__ == "__main__":
    main()
