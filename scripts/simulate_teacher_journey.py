# -*- coding: utf-8 -*-
import os
import time
from playwright.sync_api import sync_playwright

def run_simulation():
    screenshots_dir = r'e:\desktop\strj\public\test_screenshots'
    os.makedirs(screenshots_dir, exist_ok=True)

    with sync_playwright() as p:
        # Launch Chromium
        browser = p.chromium.launch(headless=True)

        # 1. Mobile Viewport (iPhone 14 / Pixel: 390 x 844)
        mobile_context = browser.new_context(
            viewport={'width': 390, 'height': 844},
            user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
            is_mobile=True,
            has_touch=True
        )
        page = mobile_context.new_page()

        print("[Step 1] Navigating to app on mobile viewport...")
        page.goto('http://localhost:5173/', wait_until='networkidle')
        time.sleep(1)

        # 2. Perform Login if Modal open
        try:
            username_input = page.locator('input[placeholder*="zs"]')
            if username_input.is_visible(timeout=2000):
                print("[Step 2] Logging in as teacher 'zs'...")
                username_input.fill('zs')
                page.locator('input[type="password"]').fill('123')
                page.locator('button[type="submit"]:visible').click()
                time.sleep(1)
        except Exception as e:
            print("Login modal check:", e)

        # 3. Chapter Drill Simulation
        print("[Step 3] Navigating to Chapter Drill...")
        page.locator('button', has_text="章节刷题").filter(visible=True).first.click()
        time.sleep(1)

        # Click first chapter
        print("[Step 4] Opening Chapter 1...")
        page.locator('h3', has_text="第11讲").filter(visible=True).first.click()
        time.sleep(1)

        # Answer question 1 -> Correct
        print("[Step 5] Answering Q1 as Correct [OK]...")
        page.locator('button', has_text="做对了").filter(visible=True).first.click()
        time.sleep(0.5)

        # Go to Next question
        page.locator('button', has_text="下一题").filter(visible=True).first.click()
        time.sleep(0.5)

        # Answer question 2 -> Wrong (X)
        print("[Step 6] Answering Q2 as Wrong [ERR]...")
        page.locator('button', has_text="做错了").filter(visible=True).first.click()
        time.sleep(0.5)

        # Capture Mobile Drill Screenshot
        drill_shot = os.path.join(screenshots_dir, '01_mobile_drill.png')
        page.screenshot(path=drill_shot, full_page=False)
        print(f"Captured: {drill_shot}")

        # Close Modal
        print("Closing question modal...")
        page.locator('button', has_text="×").filter(visible=True).first.click()
        time.sleep(0.5)

        # 4. Error Book Simulation
        print("[Step 7] Checking Error Book...")
        page.locator('button', has_text="错题本").filter(visible=True).first.click()
        time.sleep(1)

        error_shot = os.path.join(screenshots_dir, '02_mobile_errorbook.png')
        page.screenshot(path=error_shot, full_page=False)
        print(f"Captured: {error_shot}")

        # 5. Paper Generator Simulation
        print("[Step 8] Checking Paper Generator...")
        page.locator('button', has_text="组卷打印").filter(visible=True).first.click()
        time.sleep(1)
        page.locator('button', has_text="立即智能生成考卷").filter(visible=True).first.click()
        time.sleep(1)

        paper_shot = os.path.join(screenshots_dir, '03_mobile_paper.png')
        page.screenshot(path=paper_shot, full_page=False)
        print(f"Captured: {paper_shot}")

        # 6. Desktop Viewport (1280 x 800)
        print("[Step 9] Checking Desktop Dashboard...")
        desktop_context = browser.new_context(viewport={'width': 1280, 'height': 800})
        d_page = desktop_context.new_page()
        d_page.goto('http://localhost:5173/', wait_until='networkidle')
        time.sleep(1)

        # Log in on desktop
        try:
            d_user_input = d_page.locator('input[placeholder*="zs"]')
            if d_user_input.is_visible(timeout=2000):
                print("Logging in on desktop as 'zs'...")
                d_user_input.fill('zs')
                d_page.locator('input[type="password"]').fill('123')
                d_page.locator('button[type="submit"]:visible').click()
                time.sleep(1)
        except Exception as e:
            print("Desktop login check:", e)

        dash_shot = os.path.join(screenshots_dir, '04_desktop_dashboard.png')
        d_page.screenshot(path=dash_shot, full_page=False)
        print(f"Captured: {dash_shot}")

        # 7. Desktop Paper Preview
        print("[Step 10] Checking Desktop Paper Generator...")
        d_page.locator('button', has_text="组卷打印").filter(visible=True).first.click()
        time.sleep(1)
        d_page.locator('button', has_text="立即智能生成考卷").filter(visible=True).first.click()
        time.sleep(1)

        desktop_paper_shot = os.path.join(screenshots_dir, '05_desktop_paper.png')
        d_page.screenshot(path=desktop_paper_shot, full_page=False)
        print(f"Captured: {desktop_paper_shot}")

        browser.close()
        print("\nSUCCESS: All user journey simulations and screenshots completed successfully!")

if __name__ == "__main__":
    run_simulation()
