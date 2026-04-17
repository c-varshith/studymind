import { useRef, useState, useCallback } from "react";

export function useRecorder() {
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks.current = [];
    const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.current.push(e.data); };
    mr.start();
    mediaRef.current = mr;
    setRecording(true);
  }, []);

  const stop = useCallback((): Promise<Blob> => {
    return new Promise((resolve) => {
      const mr = mediaRef.current;
      if (!mr) return resolve(new Blob());
      mr.onstop = () => {
        const blob = new Blob(chunks.current, { type: "audio/webm" });
        mr.stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        resolve(blob);
      };
      mr.stop();
    });
  }, []);

  return { recording, start, stop };
}
