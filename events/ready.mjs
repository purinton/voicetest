// events/ready.mjs
export default async function (ctx, client) {
    const { log, presence, registerSignals, voice, volume, mcpClients, mcpTools, localTools, allTools, version } = ctx;
    log.info(`Logged in as ${client.user.tag}`);
    if (presence) client.user.setPresence(presence);
    const { setupVoiceOpenAI } = await import('../src/voiceOpenAI.mjs');
    const guildId = process.env.GUILD_ID;
    const voiceChannelId = process.env.VOICE_CHANNEL_ID;
    const openAIApiKey = process.env.OPENAI_API_KEY;
    if (guildId && voiceChannelId && openAIApiKey) {
        try {
            const cleanup = await setupVoiceOpenAI({
                client,
                guildId,
                voiceChannelId,
                openAIApiKey,
                log,
                presence,
                registerSignals,
                voice,
                volume,
                mcpClients,
                mcpTools,
                localTools,
                allTools,
                version
            });
            registerSignals({
                log, shutdownHook: async () => {
                    await cleanup();
                    await client.destroy();
                }
            });
        } catch (err) {
            log.error('Voice/OpenAI setup failed:', err);
        }
    } else {
        log.warn('GUILD_ID, VOICE_CHANNEL_ID, or OPENAI_API_KEY not set. Voice/OpenAI not started.');
    }
}
