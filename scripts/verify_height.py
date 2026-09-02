"""端到端验证：文字框上下拖 = 拉高度（不改字号）+ 垂直对齐生效。

前置：Edge 已带 --remote-debugging-port=9222 运行；dev server 在 5173。
用法：browseruse venv 的 python 运行本脚本。
"""
import json
from playwright.sync_api import sync_playwright

CDP = "http://127.0.0.1:9222"
OUT = "_verify"

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

        # ---- 建一个横排文字元素并选中 ----
        page.evaluate("""() => {
          const a = window.__painterAPI;
          const t = { id:'h-text', type:'text', x:300, y:260, width:120, height:50,
            text:'hello', fontSize:40, fontFamily:1, lineHeight:1.25, strokeColor:'#1e1e1e',
            backgroundColor:'transparent', textAlign:'center', verticalAlign:'top', angle:0,
            originalText:'hello', autoResize:true,
            customData:{}, seed:1, version:1, versionNonce:1, isDeleted:false, boundElements:null,
            updated: Date.now(), link:null, status:'published', groupIds:[] };
          a.updateScene({ elements:[t], appState:{ selectedElementIds:{ 'h-text': true } } });
        }""")
        page.wait_for_timeout(1200)

        def snap():
            return page.evaluate("""() => {
              const a = window.__painterAPI;
              const t = a.getSceneElements().find(e => e.id === 'h-text');
              if (!t) return null;
              const st = a.getAppState();
              const c = document.querySelector('.excalidraw__canvas');
              const r = c.getBoundingClientRect();
              return {
                fontSize: t.fontSize, height: t.height, width: t.width,
                fixedHeight: t.customData && t.customData.fixedHeight,
                verticalAlign: t.customData && t.customData.verticalAlign,
                x: t.x, y: t.y,
                scrollX: st.scrollX, scrollY: st.scrollY, zoom: st.zoom && st.zoom.value,
                canvas: { left: r.left, top: r.top },
              };
            }""")

        # 先等面板出来，确认选中状态没有被破坏
        try:
            page.wait_for_selector(".selected-shape-actions .text-format-controls", timeout=5000)
            legends = page.evaluate(
                "() => Array.from(document.querySelectorAll('.selected-shape-actions .text-format-controls legend')).map(n=>n.textContent.trim())")
            logs.append("LEGENDS: " + json.dumps(legends, ensure_ascii=False))
        except Exception as e:
            logs.append("CONTROLS_TIMEOUT: " + str(e))

        before = snap()
        logs.append("BEFORE: " + json.dumps(before, ensure_ascii=False))

        # ---- 拖底边中间手柄（s）向下 100px ----
        z = before["zoom"] or 1
        # 手柄实际中心略低于元素底边，取 +4 px 偏移以命中 hitbox
        hx = before["canvas"]["left"] + (before["x"] + before["width"] / 2 + before["scrollX"]) * z
        hy = before["canvas"]["top"] + (before["y"] + before["height"] + before["scrollY"]) * z + 4
        logs.append(f"HANDLE(s): screen=({hx:.0f},{hy:.0f})")
        page.mouse.move(hx, hy)
        page.wait_for_timeout(200)
        # 确认光标已经变成 ns-resize，再下压；否则用再往下 2px 的备用点
        cur = page.evaluate("""() => {
          const c = Array.from(document.querySelectorAll('canvas.excalidraw__canvas')).find(x=>x.className.includes('interactive'));
          return c ? getComputedStyle(c).cursor : null;
        }""")
        logs.append("CURSOR_AT_HANDLE: " + str(cur))
        if cur != "ns-resize":
            hy += 2
            page.mouse.move(hx, hy)
            page.wait_for_timeout(100)

        page.mouse.down()
        page.mouse.move(hx, hy + 100, steps=10)
        page.wait_for_timeout(100)
        page.mouse.up()
        page.wait_for_timeout(900)

        after = snap()
        logs.append("AFTER_S_DRAG: " + json.dumps(after, ensure_ascii=False))
        ok_height = after and before and (after["height"] - before["height"] > 60)
        ok_font = after and before and (after["fontSize"] == before["fontSize"])
        ok_fixed = after and after["fixedHeight"] is not None
        logs.append(f"CHECK s-drag: 拉高成功={ok_height} 字号不变={ok_font} fixedHeight写入={ok_fixed}")

        # ---- 点垂直对齐：底部、居中、顶部，分别截图 ----
        try:
            page.wait_for_selector(".selected-shape-actions .text-format-controls", timeout=5000)
            for label, file in [("底部对齐", "va_bottom"), ("垂直居中", "va_middle"), ("顶部对齐", "va_top")]:
                page.click(f'.selected-shape-actions label[title="{label}"]')
                page.wait_for_timeout(600)
                page.screenshot(path=f"{OUT}/{file}.png")
                logs.append(f"SCREENSHOT: {file}")
            end = snap()
            logs.append("AFTER_VA_TOP: " + json.dumps(end, ensure_ascii=False))
        except Exception as e:
            logs.append(f"UI_FAIL: {e}")

        # ---- 编辑态不跳位：双击进入编辑，读 textarea paddingTop ----
        try:
            cur = snap()
            ex = cur["canvas"]["left"] + (cur["x"] + cur["width"] / 2 + cur["scrollX"]) * z
            ey = cur["canvas"]["top"] + (cur["y"] + 10 + cur["scrollY"]) * z
            page.mouse.dblclick(ex, ey)
            page.wait_for_timeout(800)
            ta = page.evaluate("""() => {
              const ta = document.querySelector('textarea');
              if (!ta) return null;
              return { paddingTop: ta.style.paddingTop, height: ta.style.height, text: ta.value };
            }""")
            page.keyboard.press("Escape")
            page.wait_for_timeout(400)
            logs.append("EDIT_TEXTAREA: " + json.dumps(ta, ensure_ascii=False))
        except Exception as e:
            logs.append(f"EDIT_FAIL: {e}")

        if errors:
            logs.append("CONSOLE_ERRORS: " + json.dumps(errors[:8], ensure_ascii=False))
        else:
            logs.append("CONSOLE_ERRORS: none")

        for line in logs:
            print(line)
        b.close()

if __name__ == "__main__":
    main()
