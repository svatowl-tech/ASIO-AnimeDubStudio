/**
 * Backstage Session Storage Service
 * Handles persistence, metadata synchronization, and file operations for backstage sessions.
 */

import { BackstageSession, TimelineBlock } from '../../types';

export class BackstageSessionStorage {
  /**
   * Checks if the project has recorded backstage sessions.
   */
  static async listSessions(projectPath?: string): Promise<string[]> {
    if (!projectPath || !window.electronAPI) return [];
    try {
      const res = await window.electronAPI.listBackstageSessions(projectPath);
      if (res.success && Array.isArray(res.data)) {
        return res.data;
      }
    } catch (e) {
      console.warn('[BackstageSessionStorage] Error listing sessions:', e);
    }
    return [];
  }

  /**
   * Finalizes video and saves session metadata JSON file.
   */
  static async finalizeAndSaveSession(
    projectPath: string,
    session: BackstageSession,
    blocks: TimelineBlock[]
  ): Promise<BackstageSession> {
    if (!window.electronAPI) return session;

    // Small delay to allow any pending chunk writes to flush
    await new Promise(r => setTimeout(r, 400));

    let finalVideoPath = `${projectPath}/takes/backstage_session_${session.id}.webm`;
    try {
      const res = await window.electronAPI.finalizeBackstageSession({
        projectPath,
        sessionId: session.id
      });
      if (res.success && res.data) {
        finalVideoPath = res.data;
      }
    } catch (err) {
      console.warn('[BackstageSessionStorage] Backend finalization warning, using webm path:', err);
    }

    const finalizedBlocks: TimelineBlock[] = blocks.map(b => {
      const bStart = b.start ?? 0;
      const bEnd = b.end ?? bStart;
      const bDuration = b.duration ?? (bEnd - bStart);
      return {
        ...b,
        duration: Number(bDuration.toFixed(3)),
        originalStart: b.originalStart !== undefined ? Number(b.originalStart.toFixed(3)) : undefined,
        originalEnd: b.originalEnd !== undefined ? Number(b.originalEnd.toFixed(3)) : undefined,
        start: Number(bStart.toFixed(3)),
        end: Number(bEnd.toFixed(3)),
      };
    });

    const finalizedSpeakingSegments = finalizedBlocks
      .filter(b => b.type === 'speaking')
      .map(b => ({ start: b.start, end: b.end }));

    const completedSession: BackstageSession = {
      ...session,
      videoPath: finalVideoPath,
      rawVideoPath: finalVideoPath,
      sessionId: session.id,
      totalDuration: session.duration / 1000,
      speakingActivities: finalizedSpeakingSegments,
      blocks: finalizedBlocks
    };

    try {
      const jsonContent = JSON.stringify(completedSession, null, 2);
      await window.electronAPI.writeTextFile({
        path: `${projectPath}/takes/backstage_session_${session.id}.json`,
        data: jsonContent
      });
    } catch (jsonErr) {
      console.error('[BackstageSessionStorage] Error saving session JSON:', jsonErr);
    }

    return completedSession;
  }

  /**
   * Deletes temporary recording files when a session is aborted or cancelled.
   */
  static async cleanupAbortedSession(projectPath: string, sessionId: string): Promise<void> {
    if (!window.electronAPI) return;
    try {
      await window.electronAPI.deleteFile(`${projectPath}/takes/backstage_session_${sessionId}.webm`).catch(() => {});
      await window.electronAPI.deleteFile(`${projectPath}/takes/backstage_session_${sessionId}.json`).catch(() => {});
    } catch (e) {
      console.warn('[BackstageSessionStorage] Error cleaning aborted session files:', e);
    }
  }
}
