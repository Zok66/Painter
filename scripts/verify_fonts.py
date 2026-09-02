# -*- coding: utf-8 -*-
"""验证 Painter 字体 self-host 是否生效：
1. 画布字体请求是否全部来自本地 localhost（无 esm.sh / esm.run CDN）
2. EXCALIDRAW_ASSET_PATH 是否正确注入
3. document.fonts 中 Excalifont 的加载状态
"""
import json
import sys
import time

from playwright.sync_api import sync_playwright

URL = "http://[::1]:5173"
font_requests = []

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp("http://127.0.0.1:9222")
    ctx = browser.contexts[0] if browser.contexts else browser.new_context()
    page = ctx.new_page()

    def on_request(req):
        u = req.url.lower()
        if "fonts/" in u or ".woff2" in u or "esm.sh" in u or "esm.run" in u:
            font_requests.append({"url": req.url, "status": None})

    page.on("request", on_request)
    page.goto(URL, wait_until="load", timeout=30000)
    # 等 Excalidraw 初始化与字体懒加载
    page.wait_for_timeout(6000)

    result = page.evaluate("""() => {
      const families = [];
      try {
        document.fonts.forEach(f => families.push({
          family: f.family,
          status: f.status
        }));
      } catch (e) {}
      return {
        assetPath: window.EXCALIDRAW_ASSET_PATH ?? null,
        fontFamilies: families.filter(f => /excalifont|xiaolai|virgil|cascadia|nunito|lilita|comic|liberation/i.test(f.family)),
        pageTitle: document.title,
      };
    }""")

    print("=== 页面信息 ===")
    print(json.dumps({k: v for k, v in result.items() if k != "fontFamilies"}, ensure_ascii=False, indent=2))
    print("=== 注册的 Excalidraw 字体状态 ===")
    for f in result["fontFamilies"]:
        print(f"  {f['family']}: {f['status']}")
    print("=== 字体/CDN 网络请求 ===")
    seen = set()
    for r in font_requests:
        key = r["url"].split("?")[0]
        if key in seen:
            continue
        seen.add(key)
        print(f"  {key}")
    cdn = [r for r in font_requests if "esm.sh" in r["url"] or "esm.run" in r["url"]]
    print(f"\n结论: 共 {len(seen)} 个字体请求, 其中 CDN(esm.sh/esm.run) 请求 {len(cdn)} 个")
    page.close()
