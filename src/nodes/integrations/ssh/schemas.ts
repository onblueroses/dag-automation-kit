import { z } from "zod";

export const SshExecInputSchema = z.object({
	host: z.string(),
	command: z.string(),
	user: z.string().default("root"),
	port: z.number().default(22),
	privateKeyPath: z.string().optional(),
	timeoutMs: z.number().default(30000),
});

export type SshExecInput = z.infer<typeof SshExecInputSchema>;

export const SshExecOutputSchema = z.object({
	stdout: z.string(),
	stderr: z.string(),
	exitCode: z.number(),
});

export type SshExecOutput = z.infer<typeof SshExecOutputSchema>;
