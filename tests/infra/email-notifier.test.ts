import { describe, expect, it, vi } from "vitest";
import { EmailNotifier } from "../../src/infra/email-notifier.js";

function makeMockTransporter() {
	return {
		sendMail: vi.fn().mockResolvedValue({ messageId: "test-123" }),
	};
}

const baseConfig = {
	smtpHost: "smtp.example.com",
	smtpPort: 587,
	smtpUser: "user",
	smtpPass: "pass",
	fromAddress: "from@example.com",
	toAddress: "to@example.com",
	approvalBaseUrl: "http://localhost:3008",
};

describe("EmailNotifier", () => {
	it("sends approval email with correct fields", async () => {
		const transport = makeMockTransporter();
		const notifier = new EmailNotifier(baseConfig, transport as never);

		await notifier.sendApproval({
			workflowId: "wf-001",
			message: "Draft post about the new release",
		});

		expect(transport.sendMail).toHaveBeenCalledOnce();
		const call = transport.sendMail.mock.calls[0][0];
		expect(call.from).toBe("from@example.com");
		expect(call.to).toBe("to@example.com");
		expect(call.subject).toContain("wf-001");
	});

	it("includes approve and reject links in HTML", async () => {
		const transport = makeMockTransporter();
		const notifier = new EmailNotifier(baseConfig, transport as never);

		await notifier.sendApproval({
			workflowId: "wf-001",
			message: "Some draft",
		});

		const html = transport.sendMail.mock.calls[0][0].html;
		expect(html).toContain("http://localhost:3008/approve/wf-001");
		expect(html).toContain("http://localhost:3008/reject/wf-001");
	});

	it("includes message text in HTML", async () => {
		const transport = makeMockTransporter();
		const notifier = new EmailNotifier(baseConfig, transport as never);

		await notifier.sendApproval({
			workflowId: "wf-001",
			message: "Draft about the Q3 report",
		});

		const html = transport.sendMail.mock.calls[0][0].html;
		expect(html).toContain("Draft about the Q3 report");
	});

	it("includes metadata when provided", async () => {
		const transport = makeMockTransporter();
		const notifier = new EmailNotifier(baseConfig, transport as never);

		await notifier.sendApproval({
			workflowId: "wf-001",
			message: "Draft",
			metadata: { source: "rss-feed", topic: "release-notes" },
		});

		const html = transport.sendMail.mock.calls[0][0].html;
		expect(html).toContain("rss-feed");
		expect(html).toContain("release-notes");
	});

	it("escapes HTML in message", async () => {
		const transport = makeMockTransporter();
		const notifier = new EmailNotifier(baseConfig, transport as never);

		await notifier.sendApproval({
			workflowId: "wf-001",
			message: '<script>alert("xss")</script>',
		});

		const html = transport.sendMail.mock.calls[0][0].html;
		expect(html).not.toContain("<script>");
		expect(html).toContain("&lt;script&gt;");
	});
});
