import { joinVoiceChannel, createAudioPlayer } from '@discordjs/voice';
import { ChannelType } from 'discord.js';

export function setupVoiceConnection({ client, guildId, voiceChannelId, log }) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw new Error('Guild not found');
    const channel = guild.channels.cache.get(voiceChannelId);
    if (!channel || channel.type !== ChannelType.GuildVoice) throw new Error('Voice channel not found');
    const voiceConnection = joinVoiceChannel({
        channelId: voiceChannelId,
        guildId,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false,
    });
    const audioPlayer = createAudioPlayer();
    voiceConnection.subscribe(audioPlayer);
    log.debug('Joined voice channel');
    return { voiceConnection, audioPlayer };
}
