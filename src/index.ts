import { initAgent } from "./core/services/agent.service";
import { startTelegramBot } from "./platforms/telegram/bot";

let agent = await initAgent();

startTelegramBot(agent);
