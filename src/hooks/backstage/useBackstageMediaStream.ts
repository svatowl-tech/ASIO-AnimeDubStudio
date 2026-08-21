import { useState, useEffect } from 'react';
import { BackstageMediaSourceService } from '../../services/backstage/backstageMediaSourceService';

export interface UseBackstageMediaStreamProps {
  audioDeviceId?: string;
  isAudioActive?: boolean;
}

export const useBackstageMediaStream = ({
  audioDeviceId,
  isAudioActive
}: UseBackstageMediaStreamProps) => {
  const [backstageStream, setBackstageStream] = useState<MediaStream | null>(null);
  const [deviceLabel, setDeviceLabel] = useState<string>('');

  useEffect(() => {
    let isActive = true;
    let acquiredStream: MediaStream | null = null;

    if (!isAudioActive || audioDeviceId === 'none') {
      setBackstageStream(prev => {
        BackstageMediaSourceService.stopStream(prev);
        return null;
      });
      setDeviceLabel('None');
      return;
    }

    const initStream = async () => {
      const result = await BackstageMediaSourceService.acquireAudioStream(audioDeviceId);
      if (!isActive) {
        BackstageMediaSourceService.stopStream(result.stream);
        return;
      }

      if (result.stream) {
        acquiredStream = result.stream;
        setBackstageStream(result.stream);
        setDeviceLabel(result.deviceLabel);
      } else {
        setBackstageStream(null);
        setDeviceLabel('Unavailable');
      }
    };

    initStream();

    return () => {
      isActive = false;
      BackstageMediaSourceService.stopStream(acquiredStream);
      setBackstageStream(prev => {
        BackstageMediaSourceService.stopStream(prev);
        return null;
      });
    };
  }, [audioDeviceId, isAudioActive]);

  return {
    backstageStream,
    deviceLabel,
    setBackstageStream
  };
};
