document.addEventListener('DOMContentLoaded', () => {
    const talkBtn = document.getElementById('talkBtn');
    const disconnectBtn = document.getElementById('disconnectBtn');
    const controlsBottom = document.getElementById('controlsBottom');

    const connectPrompt = document.getElementById('connectPrompt');
    const tjFace = document.getElementById('tjFace');
    const mouth = document.getElementById('mouth');

    // Configuration
    const VPS_DOMAIN = 'tj.convoply.online'; // <-- Your new secure domain
    // const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    // Automatically switch between local testing and production VPS
    const WS_URL = `wss://${VPS_DOMAIN}`;
    // const WS_URL = isLocal ? 'ws://localhost:8765' : `wss://${VPS_DOMAIN}`;

    let isConnected = false;
    let isListening = false;
    let isSpeaking = false;
    let ws = null;

    // Web Audio API Variables
    let audioContext = null;
    let mediaStream = null;
    let processor = null;
    let nextPlayTime = 0;

    function log(message, type = 'info') {
        console.log(`[${type.toUpperCase()}] ${message}`);
    }

    function setConnected(status) {
        isConnected = status;
        if (status) {
            connectPrompt.style.display = 'none';

            // Show controls and update face
            controlsBottom.classList.add('show');
            tjFace.classList.remove('disconnected');
            tjFace.style.cursor = 'default';
            talkBtn.disabled = false;

            // Auto-activate mic on connect
            setListening(true);
        } else {
            connectPrompt.style.display = 'block';
            connectPrompt.textContent = 'Click TJ to Connect';

            // Hide controls and update face
            controlsBottom.classList.remove('show');
            tjFace.classList.add('disconnected');
            tjFace.style.cursor = 'pointer';

            // Reset emotions
            tjFace.classList.remove('emotion-happy', 'emotion-sad', 'emotion-angry', 'emotion-shocked');

            if (isListening) setListening(false);
            setSpeaking(false);
        }
    }

    // SVG Icons
    const MIC_ON_SVG = `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
      <line x1="12" y1="19" x2="12" y2="23"></line>
      <line x1="8" y1="23" x2="16" y2="23"></line>
    </svg>`;

    const MIC_OFF_SVG = `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <line x1="1" y1="1" x2="23" y2="23"></line>
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
      <line x1="12" y1="19" x2="12" y2="23"></line>
      <line x1="8" y1="23" x2="16" y2="23"></line>
    </svg>`;

    async function setListening(status) {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            log('Cannot start listening, WebSocket not connected.', 'error');
            return;
        }

        isListening = status;
        if (status) {
            tjFace.classList.add('listening');
            talkBtn.innerHTML = MIC_ON_SVG;
            talkBtn.classList.add('active-mic');
            log('Listening for audio...', 'info');

            try {
                if (!audioContext) {
                    audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
                }
                if (audioContext.state === 'suspended') {
                    await audioContext.resume();
                }

                mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                const source = audioContext.createMediaStreamSource(mediaStream);

                processor = audioContext.createScriptProcessor(4096, 1, 1);

                processor.onaudioprocess = (e) => {
                    if (!isListening || ws.readyState !== WebSocket.OPEN) return;

                    const inputData = e.inputBuffer.getChannelData(0);
                    // Convert Float32 to Int16 PCM
                    const pcmData = new Int16Array(inputData.length);
                    for (let i = 0; i < inputData.length; i++) {
                        let s = Math.max(-1, Math.min(1, inputData[i]));
                        pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                    }
                    // Send to bridge
                    ws.send(pcmData.buffer);
                };

                source.connect(processor);
                processor.connect(audioContext.destination);

            } catch (err) {
                log(`Microphone access failed: ${err.message}`, 'error');
                setListening(false);
            }

        } else {
            tjFace.classList.remove('listening');
            talkBtn.innerHTML = MIC_OFF_SVG;
            talkBtn.classList.remove('active-mic');
            log('Stopped listening.', 'info');

            // Send end signal
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(" AUDIO_END");
            }

            // Cleanup mic stream
            if (processor) {
                processor.disconnect();
                processor = null;
            }
            if (mediaStream) {
                mediaStream.getTracks().forEach(track => track.stop());
                mediaStream = null;
            }
        }
    }

    function setSpeaking(status) {
        isSpeaking = status;
        if (status) {
            mouth.classList.add('speaking');
            log('TJ is speaking...', 'success');
        } else {
            mouth.classList.remove('speaking');
            log('TJ stopped speaking', 'info');
        }
    }

    function playAudio(pcmData) {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        }

        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }

        const int16Array = new Int16Array(pcmData);
        const float32Array = new Float32Array(int16Array.length);

        for (let i = 0; i < int16Array.length; i++) {
            float32Array[i] = int16Array[i] / (int16Array[i] < 0 ? 0x8000 : 0x7FFF);
        }

        const audioBuffer = audioContext.createBuffer(1, float32Array.length, 24000);
        audioBuffer.getChannelData(0).set(float32Array);

        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContext.destination);

        const currentTime = audioContext.currentTime;
        if (nextPlayTime < currentTime) {
            nextPlayTime = currentTime + 0.1;
        }

        source.start(nextPlayTime);
        nextPlayTime += audioBuffer.duration;
    }

    // Connect when clicking the face (if disconnected)
    tjFace.addEventListener('click', async () => {
        if (isConnected) return; // Do nothing if already connected

        log(`Attempting to connect to ${WS_URL}...`, 'info');
        connectPrompt.textContent = 'Connecting...';

        try {
            ws = new WebSocket(WS_URL);
            ws.binaryType = "arraybuffer";

            ws.onopen = () => {
                log('WebSocket connected successfully!', 'success');
                setConnected(true);
            };

            ws.onerror = (err) => {
                log('Connection error occurred', 'error');
                setConnected(false);
            };

            ws.onclose = () => {
                log('Connection closed', 'info');
                setConnected(false);
            };

            ws.onmessage = async (event) => {
                if (typeof event.data === "string") {
                    if (event.data.startsWith("FACE:")) {
                        const emotion = event.data.split(":")[1];
                        log(`Emotion received: ${emotion}`, 'info');

                        // Reset all emotions first
                        tjFace.classList.remove('emotion-happy', 'emotion-sad', 'emotion-angry', 'emotion-shocked');

                        // Apply the new emotion class
                        if (emotion === 'HAPPY') {
                            tjFace.classList.add('emotion-happy');
                        } else if (emotion === 'SAD') {
                            tjFace.classList.add('emotion-sad');
                        } else if (emotion === 'SHOCKED') {
                            tjFace.classList.add('emotion-shocked');
                        } else if (emotion === 'ANGRY') {
                            tjFace.classList.add('emotion-angry');
                        }
                    } else if (event.data === "TURN_DONE") {
                        setSpeaking(false);
                        log('Gemini turn completed', 'info');
                    }
                } else if (event.data instanceof ArrayBuffer) {
                    if (!isSpeaking) {
                        setSpeaking(true);
                    }
                    playAudio(event.data);
                }
            };

        } catch (error) {
            log(`Connection failed: ${error.message}`, 'error');
            setConnected(false);
        }
    });

    // Disconnect button handler
    disconnectBtn.addEventListener('click', () => {
        log('Disconnecting from backend...', 'info');
        if (ws) {
            ws.close();
            ws = null;
        }
        setConnected(false);
    });

    // Mic toggle handler
    talkBtn.addEventListener('click', () => {
        if (!isConnected) return;
        setListening(!isListening);
    });

    log('TJ Frontend Initialized', 'info');

    // Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(reg => log('Service Worker registered successfully!', 'success'))
            .catch(err => log(`Service Worker registration failed: ${err}`, 'error'));
    }
});
