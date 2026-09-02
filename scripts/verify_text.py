import json
from playwright.sync_api import sync_playwright

CDP = "http://127.0.0.1:9222"

def main():
    logs = []
    with sync_playwright() as p:
        b = p.chromium.connect_over_cdp(CDP)
        page = b.contexts[0].pages[0]
        errors = []
        page.on("console", lambda m: errors.append(f"{m.type}:{m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror:{e}"))
        page.goto("http://127.0.0.1:5173/", wait_until="load", timeout=20000)
        page.wait_for_timeout(2500)

        # ---- unit: measure hook ----
        meas = page.evaluate("""() => {
          const v = window.__painterMeasureText({text:'AB\\nCD', fontSize:40, lineHeight:1.25, fontFamily:1, customData:{textDirection:'vertical'}});
          const h = window.__painterMeasureText({text:'AB', fontSize:40, lineHeight:1.25, fontFamily:1, customData:{}});
          const hs = window.__painterMeasureText({text:'AB', fontSize:40, lineHeight:1.25, fontFamily:1, customData:{letterSpacing:5}});
          return {v,h,hs};
        }""")
        logs.append("MEASURE: " + json.dumps(meas, ensure_ascii=False))

        # ---- create a text element ----
        geo = page.evaluate("""() => { const c=document.querySelector('.excalidraw__canvas'); const r=c.getBoundingClientRect(); return {left:r.left,top:r.top,w:r.width,h:r.height}; }""")
        cx = geo["left"] + geo["w"] * 0.4
        cy = geo["top"] + geo["h"] * 0.4
        page.mouse.dblclick(cx, cy)
        page.wait_for_timeout(400)
        page.keyboard.type("hello")
        page.wait_for_timeout(300)
        page.keyboard.press("Escape")  # commit + keep selected
        page.wait_for_timeout(600)

        # guarantee selection via API (fallback)
        page.evaluate("""() => {
          const a = window.__painterAPI;
          const els = a.getSceneElements();
          const t = els.find(e => e.type === 'text');
          if (t) { a.updateScene({ appState: { selectedElementIds: { [t.id]: true } } }); }
        }""")
        page.wait_for_timeout(900)

        sel = page.evaluate("""() => { const a=window.__painterAPI; const ids=Object.keys(a.getAppState().selectedElementIds||{}); const els=a.getSceneElements(); const t=els.find(e=>e.type==='text'); return {ids, hasText:!!t, textId: t?t.id:null, count: els.length}; }""")
        logs.append("SELECT: " + json.dumps(sel, ensure_ascii=False))

        # ---- wait for controls inside native container ----
        try:
            page.wait_for_selector(".selected-shape-actions .text-format-controls", timeout=5000)
            logs.append("CONTROLS_VISIBLE: true")
        except Exception as e:
            logs.append("CONTROLS_VISIBLE: false (" + str(e) + ")")

        legends = page.evaluate("""() => Array.from(document.querySelectorAll('.selected-shape-actions .text-format-controls legend')).map(n=>n.textContent.trim())""")
        logs.append("LEGENDS: " + json.dumps(legends, ensure_ascii=False))

        # ---- click 竖排 ----
        try:
            page.click("label[title='竖排']")
            page.wait_for_timeout(500)
        except Exception as e:
            logs.append("CLICK_VERT: " + str(e))
        dir_state = page.evaluate("""() => { const a=window.__painterAPI; const els=a.getSceneElements(); const t=els.find(e=>e.type==='text'); return {textDirection: t.customData && t.customData.textDirection, w:Math.round(t.width), h:Math.round(t.height)}; }""")
        logs.append("AFTER_VERT: " + json.dumps(dir_state, ensure_ascii=False))
        page.screenshot(path="_verify/text_vertical.png")

        # ---- back to 横排 ----
        try:
            page.click("label[title='横排']")
            page.wait_for_timeout(300)
        except Exception as e:
            logs.append("CLICK_HORIZ: " + str(e))

        # ---- set 行距 = 2.0 ----
        page.evaluate("""(val) => {
          const inp=document.querySelector('.text-format-controls fieldset:nth-of-type(2) input[type=range]');
          if(inp){ const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(inp, String(val)); inp.dispatchEvent(new Event('input',{bubbles:true})); inp.dispatchEvent(new Event('change',{bubbles:true})); }
        }""", 2.0)
        page.wait_for_timeout(400)
        lh = page.evaluate("""() => { const a=window.__painterAPI; const t=a.getSceneElements().find(e=>e.type==='text'); return t.lineHeight; }""")
        logs.append("AFTER_LINEHEIGHT: " + json.dumps(lh, ensure_ascii=False))

        # ---- set 字体间距 = 12 ----
        page.evaluate("""(val) => {
          const inp=document.querySelector('.text-format-controls fieldset:nth-of-type(3) input[type=range]');
          if(inp){ const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(inp, String(val)); inp.dispatchEvent(new Event('input',{bubbles:true})); inp.dispatchEvent(new Event('change',{bubbles:true})); }
        }""", 12)
        page.wait_for_timeout(400)
        ls = page.evaluate("""() => { const a=window.__painterAPI; const t=a.getSceneElements().find(e=>e.type==='text'); return t.customData && t.customData.letterSpacing; }""")
        logs.append("AFTER_LETTERSPACING: " + json.dumps(ls, ensure_ascii=False))
        # 滚动原生面板到底部，让 行距/字体间距 滑块可见
        page.evaluate("""() => {
          const inner = document.querySelector('.selected-shape-actions:not(.zen-mode-transition)');
          const outer = document.querySelector('.selected-shape-actions-container');
          if (inner) inner.scrollTop = inner.scrollHeight;
          if (outer) outer.scrollTop = outer.scrollHeight;
          document.querySelectorAll('.text-format-controls .text-format-range input[type=range]').forEach((inp, i) => {
            if (i === 0) inp.value = '2.00';
            if (i === 1) inp.value = '12';
            inp.dispatchEvent(new Event('input', {bubbles:true}));
            inp.dispatchEvent(new Event('change', {bubbles:true}));
          });
        }""")
        page.wait_for_timeout(400)
        # 单独截取两个滑块区域
        sliders = page.query_selector_all('.text-format-controls .text-format-range input[type=range]')
        if len(sliders) >= 2:
            b1 = sliders[0].bounding_box()
            b2 = sliders[1].bounding_box()
            if b1 and b2:
                clip = {
                    "x": min(b1["x"], b2["x"]) - 8,
                    "y": b1["y"] - 12,
                    "width": max(b1["x"]+b1["width"], b2["x"]+b2["width"]) - min(b1["x"], b2["x"]) + 16,
                    "height": b2["y"] + b2["height"] - b1["y"] + 24,
                }
                page.screenshot(path="_verify/slider_closeup.png", clip=clip)
        page.screenshot(path="_verify/text_controls.png")

        logs.append("CONSOLE_ERRORS: " + json.dumps(errors[:12], ensure_ascii=False))

    with open("_verify/verify_log.txt", "w", encoding="utf-8") as f:
        f.write("\n".join(logs))
    print("\n".join(logs))

main()
