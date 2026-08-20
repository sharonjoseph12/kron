/**
 * Zod schemas used for request validation across the KRON API.
 */
import { z } from "zod";
import { NETWORK } from "./protocol.js";

export const RoleSchema = z.enum(["admin", "operator", "viewer"]);

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const CreateAgentSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
});

export const CreateMCPServerSchema = z.object({
  name: z.string().min(1).max(80),
  url: z.string().url(),
  transport: z.enum(["streamable-http", "sse"]).default("streamable-http"),
  authToken: z.string().max(500).optional(),
});

export const MCPServerHealthSchema = z.object({
  serverId: z.string().min(1),
});

export const StartSessionSchema = z.object({
  agentId: z.string().min(1),
  task: z.string().max(2000).optional(),
});

export const ToolCallSchema = z.object({
  sessionId: z.string().min(1),
  tool: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).default({}),
});

export const PolicyUpdateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  perCallLimitAlgo: z.number().nonnegative().optional(),
  hardCeilingAlgo: z.number().nonnegative().optional(),
  sessionBudgetAlgo: z.number().nonnegative().optional(),
  dailyBudgetAlgo: z.number().nonnegative().optional(),
  maxDailyPayments: z.number().int().nonnegative().optional(),
  unknownRecipient: z.enum(["block", "escalate", "allow"]).optional(),
  firstTimeService: z.enum(["block", "escalate", "allow"]).optional(),
  recipientAllowlist: z.array(z.string()).optional(),
  recipientBlocklist: z.array(z.string()).optional(),
  serviceAllowlist: z.array(z.string()).optional(),
  serviceBlocklist: z.array(z.string()).optional(),
  emergencyStop: z.boolean().optional(),
});

export const ActivatePolicySchema = z.object({
  version: z.number().int().positive(),
});

export const SimulatePolicySchema = z.object({
  draft: z.object({
    perCallLimitAlgo: z.number().nonnegative(),
    hardCeilingAlgo: z.number().nonnegative(),
    sessionBudgetAlgo: z.number().nonnegative(),
    dailyBudgetAlgo: z.number().nonnegative(),
    maxDailyPayments: z.number().int().nonnegative(),
    unknownRecipient: z.enum(["block", "escalate", "allow"]),
    firstTimeService: z.enum(["block", "escalate", "allow"]),
    recipientAllowlist: z.array(z.string()).default([]),
    recipientBlocklist: z.array(z.string()).default([]),
    serviceAllowlist: z.array(z.string()).default([]),
    serviceBlocklist: z.array(z.string()).default([]),
    emergencyStop: z.boolean().default(false),
  }),
  lookbackTransactions: z.number().int().positive().max(5000).default(100),
});

export const PaymentFlowSchema = z.object({
  agentId: z.string().min(1),
  sessionId: z.string().min(1),
  toolCallId: z.string().min(1),
  mcpServerId: z.string().min(1),
  toolName: z.string().min(1),
  service: z.string().min(1),
  resourceId: z.string().min(1),
  resourceName: z.string().min(1),
  recipient: z.string().min(1),
  amountAlgo: z.number().positive(),
  network: NETWORK,
  clientRequestId: z.string().min(1),
  instructionUrl: z.string().url().optional(),
  note: z.string().optional(),
});

export const EscalationDecisionSchema = z.object({
  escalationId: z.string().min(1),
  approve: z.boolean(),
});

export const FundWalletSchema = z.object({
  agentId: z.string().min(1),
  amountAlgo: z.number().positive().max(1000),
});
