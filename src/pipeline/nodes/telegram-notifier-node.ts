import type {
  TelegramNotifierExecutorConfig,
  TelegramNotifierExecutorInput,
  TelegramNotifierExecutorResult,
} from "../../executors/telegram-notifier-executor.js";
import { printInfo } from "../../tui.js";
import type { PipelineNodeDefinition } from "../types.js";
import { toExecutorContext } from "../types.js";

export type TelegramNotifierNodeParams = {
  message: string;
  label?: string;
};

export const telegramNotifierNode: PipelineNodeDefinition<
  TelegramNotifierNodeParams,
  TelegramNotifierExecutorResult
> = {
  kind: "telegram-notify",
  version: 1,
  async run(context, params) {
    const labelText = params.label ?? "Sending Telegram notification";
    printInfo(labelText);

    const chatId = context.env.chat_id;
    if (!chatId) {
      printInfo("Telegram notification skipped: chat_id environment variable is not set");
      return { value: { success: false } };
    }

    const executor = context.executors.get<
      TelegramNotifierExecutorConfig,
      TelegramNotifierExecutorInput,
      TelegramNotifierExecutorResult
    >("telegram-notifier");

    const input: TelegramNotifierExecutorInput = {
      chatId,
      text: params.message,
    };

    const value = await executor.execute(toExecutorContext(context), input, executor.defaultConfig);

    if (value.success) {
      printInfo(`Telegram notification sent successfully`);
    } else {
      printInfo(`Telegram notification failed`);
    }

    return { value };
  },
};