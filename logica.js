const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath);
require('dotenv').config();




console.log('Usando token:', process.env.TELEGRAM_BOT_TOKEN); // <-- Esto debería mostrar el token correctamente




const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });



bot.on('message', (msg) => {
  bot.sendMessage(msg.chat.id, '¡Hola! Soy tu ninja de la traducción. Envíame un audio y lo convertiré a texto al instante. 🎤➡️📄');
});









// Conversión mejorada a MP3
function convertOggToMp3(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioChannels(1)
      .audioFrequency(16000)
      .audioBitrate('32k')
      .audioFilters('loudnorm=I=-16:TP=-1.5:LRA=11')
      .toFormat('mp3')
      .on('error', reject)
      .on('end', () => resolve(outputPath))
      .save(outputPath);
  });
}

// Subir archivo
async function uploadToAssemblyAI(filePath) {
  const data = fs.readFileSync(filePath);
  const response = await axios.post('https://api.assemblyai.com/v2/upload', data, {
    headers: {
      'authorization': ASSEMBLYAI_API_KEY,
      'content-type': 'application/octet-stream',
    }
  });
  return response.data.upload_url;
}

// Transcribir (versión segura sin speaker_labels)
async function transcribeAudioAssembly(url) {
  try {
    const response = await axios.post('https://api.assemblyai.com/v2/transcript', {
      audio_url: url,
      language_code: 'es',
      punctuate: true,
      format_text: true
    }, {
      headers: {
        'authorization': ASSEMBLYAI_API_KEY,
        'content-type': 'application/json'
      }
    });

    if (response.data.error) {
      throw new Error(response.data.error);
    }

    return response.data.id;

  } catch (err) {
    throw new Error(`Error al iniciar la transcripción: ${err.message}`);
  }
}

// Espera de transcripción (versión mejorada)
async function waitForTranscript(id, chatId) {
  let attempts = 0;
  let lastUpdate = Date.now();
  
  while (attempts < 20) {
    await new Promise(res => setTimeout(res, 3000));
    const response = await axios.get(`https://api.assemblyai.com/v2/transcript/${id}`, {
      headers: { 'authorization': ASSEMBLYAI_API_KEY }
    });

    if (!response.data) {
      throw new Error('Respuesta inválida de la API');
    }

    const status = response.data.status;
    
    // Actualización de progreso
    if (Date.now() - lastUpdate > 10000) {
      await bot.sendMessage(chatId, `🔄 Progreso: ${status || 'desconocido'}...`);
      lastUpdate = Date.now();
    }

    if (status === 'completed') return response.data.text;
    if (status === 'error') throw new Error(`Error ASR: ${response.data.error}`);
    
    attempts++;
  }
  throw new Error('Tiempo de espera agotado');
}

// Handler principal para mensajes de voz
bot.on('voice', async (msg) => {
  const chatId = msg.chat.id;
  const uniqueId = Date.now();
  const oggPath = `voz_${uniqueId}.ogg`;
  const mp3Path = `voz_${uniqueId}.mp3`;

  try {
    // Validar duración del audio
    if (msg.voice.duration > 300) {
      await bot.sendMessage(chatId, '⚠️ El audio es demasiado largo (máximo 5 minutos)');
      return;
    }

    // Descargar archivo
    const file = await bot.getFile(msg.voice.file_id);
    console.log("hola")
    const url = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const writer = fs.createWriteStream(oggPath);
    const response = await axios({ url, method: 'GET', responseType: 'stream' });
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    // Convertir a MP3
    await convertOggToMp3(oggPath, mp3Path);
    await bot.sendMessage(chatId, '🎧 Optimizando calidad de audio...');

    // Transcribir
    const uploadUrl = await uploadToAssemblyAI(mp3Path);
    const transcriptId = await transcribeAudioAssembly(uploadUrl);
    const text = await waitForTranscript(transcriptId, chatId);  // Pasamos chatId aquí

    // Enviar resultado
    await bot.sendMessage(chatId, `📝 Transcripción:\n${text}`);

  } catch (err) {
    console.error('Error detallado:', {
      message: err.message,
      stack: err.stack,
      response: err.response?.data
    });
    
    await bot.sendMessage(chatId, `❌ Error: ${err.message || 'Error en el proceso de transcripción'}`);
    
  } finally {
    // Limpiar archivos temporales
    try { fs.unlinkSync(oggPath); } catch {}
    try { fs.unlinkSync(mp3Path); } catch {}
  }
});