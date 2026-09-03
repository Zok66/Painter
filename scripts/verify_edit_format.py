"""端到端验证：双击文本框进入编辑模式后，行距 / 字距 / 垂直对齐不丢失。

前置：Edge 已带 --remote-debugging-port=9222 运行；dev server 在 5173。
用法：browseruse venv 的 python 运行本脚本。

验证点（即用户 bug：双击编辑态行距与间距丢失）：
  - 编辑态 textarea 的 style.lineHeight 必须等于元素的 lineHeight
  - 编辑态 textarea 的 style.letterSpacing 必须等于元素的 customData.letterSpacing
  - 编辑态 textarea 的 style.paddingTop 必须反映 verticalAlign（middle/bottom > 0）
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
        for i in range(40):
            if page.evaluate("() => !!window.__painterAPI"):
                break
            page.wait_for_timeout(500)
        page.wait_for_timeout(800)

        def read_ta():
            return page.evaluate("""() => {
              const ta = document.querySelector('textarea');
              if (!ta) return null;
              const cs = getComputedStyle(ta);
              const st = window.__painterAPI.getAppState();
              const ed = st.editingElement || st.editingTextElement;
              return {
                text: ta.value,
                lineHeight: ta.style.lineHeight,
                letterSpacing: ta.style.letterSpacing,
                paddingTop: ta.style.paddingTop,
                computedLineHeight: cs.lineHeight,
                computedLetterSpacing: cs.letterSpacing,
                editingId: ed && ed.id,
              };
            }""")

        # ---- 1) 真实用户流：空画布双击新建文字 ----
        page.mouse.dblclick(440, 341)
        page.wait_for_timeout(500)
        page.keyboard.type("hello world")
        page.wait_for_timeout(300)
        page.keyboard.press("Escape")
        page.wait_for_timeout(800)
        created = page.evaluate("""() => window.__painterAPI.getSceneElements().filter(e=>e.type==='text').map(e=>({id:e.id}))""")
        eid = created[0]["id"] if created else None
        logs.append("CREATED_ID: " + str(eid))

        # ---- 2) 设置行距=1.5 / 字距=8 / 垂直对齐=middle，并把元素加高留出余量 ----
        # verticalAlign 的编辑态 paddingTop 只在「元素高度 > 文字内容高度」时生效，
        # 所以这里同时设 fixedHeight 并拉高到 150，制造 padding 空间。
        page.evaluate("""(id) => {
          const a = window.__painterAPI;
          const t = a.getSceneElements().find(e => e.id === id);
          a.mutateElement(t, {
            lineHeight: 1.5,
            height: 150,
            autoResize: false,
            customData: Object.assign({}, t.customData, { letterSpacing: 8, verticalAlign: 'middle', fixedHeight: 150 }),
          });
        }""", eid)
        page.wait_for_timeout(400)

        # ---- 3) 双击同一位置进入编辑，读 textarea ----
        page.mouse.dblclick(440, 341)
        page.wait_for_timeout(800)
        ta = read_ta()
        logs.append("EDIT_MIDDLE: " + json.dumps(ta, ensure_ascii=False))
        ok_lh = ta and ta["lineHeight"] == "1.5"
        ok_ls = ta and ta["letterSpacing"] == "8px"
        ok_va_mid = ta and ta["paddingTop"] not in ("", "0px")
        logs.append(f"CHECK middle: 行距={ok_lh} 字距={ok_ls} 垂直对齐padding={ok_va_mid}")
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)

        # ---- 4) 改成 bottom 并重新加高，再进入编辑 ----
        # 注意：上一步编辑提交后 Excalidraw 会把元素高度重算贴合文字，
        # 所以这里在进入编辑前重新把高度拉回 150，制造 bottom 的余量空间。
        page.evaluate("""(id) => {
          const a = window.__painterAPI;
          const t = a.getSceneElements().find(e => e.id === id);
          a.mutateElement(t, {
            height: 150,
            customData: Object.assign({}, t.customData, { verticalAlign: 'bottom', fixedHeight: 150 }),
          });
        }""", eid)
        page.wait_for_timeout(400)
        page.mouse.dblclick(440, 341)
        page.wait_for_timeout(800)
        ta2 = read_ta()
        logs.append("EDIT_BOTTOM: " + json.dumps(ta2, ensure_ascii=False))
        ok_va_bot = ta2 and ta2["paddingTop"] not in ("", "0px")
        logs.append(f"CHECK bottom: 垂直对齐padding={ok_va_bot}")

        # ---- 汇总 ----
        passed = ok_lh and ok_ls and ok_va_mid and ok_va_bot
        logs.append("SUMMARY: " + ("PASS" if passed else "FAIL"))
        logs.append("CONSOLE_ERRORS: " + (json.dumps(errors[:8], ensure_ascii=False) if errors else "none"))

        for line in logs:
            print(line)
        with open(f"{OUT}/verify_edit_format.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(logs))
        b.close()


if __name__ == "__main__":
    main()
