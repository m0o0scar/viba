from playwright.sync_api import Page, expect, sync_playwright
import os
import time

def test_session_creation(page: Page):
    # 1. Go to homepage
    page.goto("http://localhost:3000")

    # 2. Look for recent repo "test-repo"
    # The GitRepoSelector renders repo name as truncated path or name.
    # We can try to find text "test-repo".
    repo_item = page.get_by_text("test-repo").first
    expect(repo_item).to_be_visible()
    repo_item.click()

    # 3. Wait for details view
    # Look for "Start New Session" or input for title
    title_input = page.get_by_placeholder("Task Title")
    expect(title_input).to_be_visible()
    title_input.fill("Test Session")

    # 4. Start Session
    start_btn = page.get_by_role("button", name="Start Session")
    start_btn.click()

    # 5. Wait for session page
    # It navigates to /session?repo=...
    # We can wait for URL change or wait for element on session page.
    page.wait_for_url("**/session?*")

    # Wait a bit for terminal to init (optional for screenshot but good for stability)
    page.wait_for_timeout(2000)

    # 6. Screenshot
    if not os.path.exists("verification"):
        os.makedirs("verification")
    page.screenshot(path="verification/session_created.png")

    # 7. Check file system
    # Check ~/.viba/sessions
    home = os.path.expanduser("~")
    sessions_dir = os.path.join(home, ".viba", "sessions")
    files = os.listdir(sessions_dir)
    print(f"Session files: {files}")
    if not any(f.endswith(".json") for f in files):
        raise Exception("No session file created!")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            test_session_creation(page)
            print("Verification successful!")
        except Exception as e:
            print(f"Verification failed: {e}")
            page.screenshot(path="verification/failure.png")
        finally:
            browser.close()
