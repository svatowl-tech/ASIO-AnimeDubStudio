/**
 * Generates a clean, self-contained local Demo Video Blob for the web preview.
 * This runs 100% in-browser using HTML5 Canvas + Web Audio API + MediaRecorder.
 * No external network requests, zero CORS issues, guaranteed native format support.
 */

let cachedDemoVideoBlobUrl: string | null = null;
let generationPromise: Promise<string> | null = null;

export async function getOrCreateDemoVideoBlobUrl(): Promise<string> {
  if (cachedDemoVideoBlobUrl) {
    return cachedDemoVideoBlobUrl;
  }
  if (generationPromise) {
    return generationPromise;
  }

  generationPromise = new Promise<string>((resolve) => {
    try {
      if (typeof window === 'undefined' || !window.MediaRecorder) {
        resolve('');
        return;
      }

      const width = 1280;
      const height = 720;
      const fps = 30;
      const durationSeconds = 10;
      const totalFrames = fps * durationSeconds;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        resolve('');
        return;
      }

      // Prepare Web Audio for demo sound
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      let audioDest: MediaStreamAudioDestinationNode | null = null;
      let audioCtx: AudioContext | null = null;
      
      try {
        audioCtx = new AudioCtx();
        audioDest = audioCtx.createMediaStreamDestination();
        
        // Gentle demo ambient tone
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, audioCtx.currentTime); // A4
        gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
        osc.connect(gain);
        gain.connect(audioDest);
        osc.start();
      } catch {
        // Audio optional for canvas stream
      }

      const canvasStream = canvas.captureStream(fps);
      if (audioDest) {
        audioDest.stream.getAudioTracks().forEach((track) => {
          canvasStream.addTrack(track);
        });
      }

      let mimeType = 'video/webm;codecs=vp8,opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = MediaRecorder.isTypeSupported('video/webm')
          ? 'video/webm'
          : MediaRecorder.isTypeSupported('video/mp4')
          ? 'video/mp4'
          : '';
      }

      const recorder = mimeType
        ? new MediaRecorder(canvasStream, { mimeType, videoBitsPerSecond: 2500000 })
        : new MediaRecorder(canvasStream);

      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      recorder.onstop = () => {
        try {
          if (audioCtx && audioCtx.state !== 'closed') {
            audioCtx.close().catch(() => {});
          }
          canvasStream.getTracks().forEach((t) => t.stop());
        } catch {}

        const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
        const url = URL.createObjectURL(blob);
        cachedDemoVideoBlobUrl = url;
        resolve(url);
      };

      recorder.start();

      let currentFrame = 0;
      const renderFrame = () => {
        const t = currentFrame / fps;
        const progress = t / durationSeconds;

        // Background gradient
        const bgGrad = ctx.createLinearGradient(0, 0, width, height);
        bgGrad.addColorStop(0, '#09090b');
        bgGrad.addColorStop(0.5, '#18181b');
        bgGrad.addColorStop(1, '#09090b');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, width, height);

        // Grid background
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.lineWidth = 1;
        const gridSize = 40;
        for (let x = 0; x < width; x += gridSize) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
          ctx.stroke();
        }
        for (let y = 0; y < height; y += gridSize) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(width, y);
          ctx.stroke();
        }

        // Animated Central Waveform
        const barCount = 48;
        const barWidth = 14;
        const gap = 8;
        const totalBarWidth = barCount * (barWidth + gap);
        const startX = (width - totalBarWidth) / 2;
        const centerY = height / 2 + 10;

        for (let i = 0; i < barCount; i++) {
          const x = startX + i * (barWidth + gap);
          const phase = i * 0.25 + t * 4;
          const waveHeight = Math.abs(Math.sin(phase) * Math.cos(phase * 0.7)) * 140 + 15;
          
          const barGrad = ctx.createLinearGradient(0, centerY - waveHeight / 2, 0, centerY + waveHeight / 2);
          barGrad.addColorStop(0, '#6366f1');
          barGrad.addColorStop(0.5, '#a855f7');
          barGrad.addColorStop(1, '#ec4899');
          
          ctx.fillStyle = barGrad;
          ctx.beginPath();
          ctx.roundRect(x, centerY - waveHeight / 2, barWidth, waveHeight, 6);
          ctx.fill();
        }

        // Title and DubStudio Pro Badge
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 36px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('DubStudio Pro', width / 2, 180);

        ctx.fillStyle = '#94a3b8';
        ctx.font = '500 20px system-ui, -apple-system, sans-serif';
        ctx.fillText('Демо-видео проекта дубляжа • 1080p 30fps', width / 2, 220);

        // Live Subtitle Preview simulation
        const currentSub = t < 3.5 
          ? '«Привет! Это тестовое превью проекта дубляжа.»'
          : t < 7.5
          ? '«Здесь вы можете записывать и монтировать реплики в реальном времени.»'
          : '«DubStudio Pro готов к работе!»';

        // Subtitle box
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        ctx.beginPath();
        ctx.roundRect(width / 2 - 400, height - 190, 800, 64, 16);
        ctx.fill();
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.4)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = '#fef08a';
        ctx.font = 'bold 22px system-ui, -apple-system, sans-serif';
        ctx.fillText(currentSub, width / 2, height - 150);

        // Timecode and progress bar
        const mm = '00';
        const ss = Math.floor(t).toString().padStart(2, '0');
        const ms = Math.floor((t % 1) * 100).toString().padStart(2, '0');
        const timecodeStr = `TC: ${mm}:${ss}.${ms} / 00:10.00`;

        ctx.fillStyle = '#64748b';
        ctx.font = 'bold 16px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(timecodeStr, 60, height - 50);

        // Bottom progress line
        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.fillRect(60, height - 35, width - 120, 4);
        
        ctx.fillStyle = '#6366f1';
        ctx.fillRect(60, height - 35, (width - 120) * progress, 4);

        currentFrame++;
        if (currentFrame < totalFrames) {
          requestAnimationFrame(renderFrame);
        } else {
          recorder.stop();
        }
      };

      renderFrame();
    } catch (err) {
      console.warn('Demo video generation fallback:', err);
      resolve('');
    }
  });

  return generationPromise;
}
