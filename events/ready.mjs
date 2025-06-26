// events/ready.mjs
export default async function ({ log, presence }, client) {
    log.debug('ready', { tag: client.user.tag });
    log.info(`Logged in as ${client.user.tag}`);
    if (presence) client.user.setPresence(presence);

    // Integrate voice + OpenAI logic
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
                log
            });
            // Optionally register cleanup for shutdown if your framework supports it
            if (typeof global !== 'undefined') {
                global.voiceOpenAICleanup = cleanup;
            }
        } catch (err) {
            log.error('Voice/OpenAI setup failed:', err);
        }
    } else {
        log.warn('GUILD_ID, VOICE_CHANNEL_ID, or OPENAI_API_KEY not set. Voice/OpenAI not started.');
    }
}
