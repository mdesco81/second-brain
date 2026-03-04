import { useState, useCallback, useRef } from "react";

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

export function useVoiceDictation() {
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<any>(null);
  const baseTextRef = useRef("");

  const isSupported =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  const start = useCallback(
    (textareaRef: React.RefObject<HTMLTextAreaElement | null>) => {
      if (!isSupported || !textareaRef.current) return;

      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognition.lang = "pt-BR";
      recognition.continuous = true;
      recognition.interimResults = true;

      baseTextRef.current = textareaRef.current.value;

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        if (!textareaRef.current) return;
        let interimTranscript = "";
        let finalTranscript = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript;
          } else {
            interimTranscript += transcript;
          }
        }

        const base = baseTextRef.current;
        const separator = base && !base.endsWith(" ") ? " " : "";
        textareaRef.current.value =
          base + separator + finalTranscript + interimTranscript;

        if (finalTranscript) {
          baseTextRef.current = base + separator + finalTranscript;
        }
      };

      recognition.onerror = () => {
        setIsRecording(false);
        recognitionRef.current = null;
      };

      recognition.onend = () => {
        setIsRecording(false);
        recognitionRef.current = null;
      };

      recognition.start();
      recognitionRef.current = recognition;
      setIsRecording(true);
    },
    [isSupported]
  );

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsRecording(false);
  }, []);

  const toggle = useCallback(
    (textareaRef: React.RefObject<HTMLTextAreaElement | null>) => {
      if (isRecording) {
        stop();
      } else {
        start(textareaRef);
      }
    },
    [isRecording, start, stop]
  );

  return { isRecording, toggle, isSupported };
}
