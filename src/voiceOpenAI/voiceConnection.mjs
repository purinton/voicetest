import { joinVoiceChannel, createAudioPlayer } from '@discordjs/voice';

export function setupVoiceConnection({ client, guildId, voiceChannelId, log }) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw new Error('Guild not found');
    const channel = guild.channels.cache.get(voiceChannelId);
    if (!channel || channel.type !== 2) throw new Error('Voice channel not found');
    const voiceConnection = joinVoiceChannel({
        channelId: voiceChannelId,
        guildId,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false,
    });
    const audioPlayer = createAudioPlayer();
    voiceConnection.subscribe(audioPlayer);
    log.info('Joined voice channel');
    return { voiceConnection, audioPlayer };
}
