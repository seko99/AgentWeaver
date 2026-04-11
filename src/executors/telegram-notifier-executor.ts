import { telegramNotifierExecutorDefaultConfig } from "./configs/telegram-notifier-config.js";
import type { ExecutorContext, ExecutorDefinition, JsonObject } from "./types.js";

export type TelegramNotifierExecutorConfig = JsonObject & {
  printFailureOutput: boolean;
};

export type TelegramNotifierExecutorInput = {
  chatId: string;
  text: string;
};

export type TelegramNotifierExecutorResult = {
  success: boolean;
  messageId?: number;
};

export const telegramNotifierExecutor: ExecutorDefinition<
  TelegramNotifierExecutorConfig,
  TelegramNotifierExecutorInput,
  TelegramNotifierExecutorResult
> = {
  kind: "telegram-notifier",
  version: 1,
  defaultConfig: telegramNotifierExecutorDefaultConfig,
  async execute(
    context: ExecutorContext,
    input: TelegramNotifierExecutorInput,
    config: TelegramNotifierExecutorConfig,
  ) {
    const botToken = context.env.BOT_TOKEN;
    if (!botToken) {
      context.ui.writeStderr(`Telegram notifier error: BOT_TOKEN environment variable is not set\n`);
      return { success: false };
    }

    if (!input.chatId) {
      context.ui.writeStderr(`Telegram notifier error: chatId is required\n`);
      return { success: false };
    }

    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: input.chatId,
          text: input.text,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (config.printFailureOutput) {
          context.ui.writeStderr(`Telegram API error: ${response.status} ${response.statusText}\n${errorText}\n`);
        }
        return { success: false };
      }

      const data = (await response.json()) as { ok: boolean; result?: { message_id: number } };
      if (!data.ok) {
        context.ui.writeStderr(`Telegram API error: ${JSON.stringify(data)}\n`);
        return { success: false };
      }

      const messageId = data.result?.message_id;
      if (messageId !== undefined) {
        return { success: true, messageId };
      }
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (config.printFailureOutput) {
        context.ui.writeStderr(`Telegram notifier error: ${errorMessage}\n`);
      }
      return { success: false };
    }
  },
};