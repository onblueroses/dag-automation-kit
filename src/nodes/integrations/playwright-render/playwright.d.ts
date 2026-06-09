declare module "playwright" {
	interface Page {
		setContent(html: string, options?: { waitUntil?: string }): Promise<void>;
		screenshot(options?: {
			path?: string;
			fullPage?: boolean;
		}): Promise<Buffer>;
	}

	interface Browser {
		newPage(options?: {
			viewport?: { width: number; height: number };
		}): Promise<Page>;
		close(): Promise<void>;
	}

	interface BrowserType {
		launch(options?: { headless?: boolean }): Promise<Browser>;
	}

	export const chromium: BrowserType;
}
