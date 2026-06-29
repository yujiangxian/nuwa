import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useToastStore } from '@/store/toastStore';
import VoiceStudioPage from './VoiceStudioPage';

/**
 * VoiceStudioPage 单元测试。
 *
 * 覆盖三个 Tab：
 *  - 语音合成（既有，任务 7.2 / 任务 15 无回归）：提交请求体含 model_id/ref_audio/ref_text，
 *    且不含 VoxCPM 专有字段；selectedVoice.path/transcript 选用链路不变。
 *  - 声音克隆（任务 13.1）：控件存在；选文件 / 录音提交构造正确 multipart 字段；
 *    无音频 / 无名称拦截；成功重置表单；失败展示后端 error 文本。
 *  - 声音库（任务 14.1）：展示 name/transcript/sample_rate 与可选 duration；加载/空/错误态；
 *    试听以 voiceAudioUrl(id) 调用 player 且 toggle；删除二次确认。
 *
 * 通过 vi.mock 隔离数据源（useVoices/useConfig/useSynthesize/useUploadVoice/useDeleteVoice/
 * voiceAudioUrl）、播放器（useAudioPlayer）与录音器（useRecorder）。真实 useToastStore /
 * useUIStore 被使用，以便断言 toast 与表单交互。
 */

// vi.hoisted：在 mock 工厂提升前创建可变状态与 spy，供工厂与测试共享。
const h = vi.hoisted(() => ({
  state: {
    voices: [] as Array<{
      id: string;
      name: string;
      path: string;
      transcript: string | null;
      sample_rate: number;
      duration_seconds?: number | null;
    }>,
    voicesLoading: false,
    voicesError: false,
    config: undefined as unknown,
  },
  recorder: {
    isRecording: false,
    recordingTime: 0,
    error: null as string | null,
  },
  spies: {
    synthMutate: vi.fn(),
    uploadMutate: vi.fn(),
    deleteMutate: vi.fn(),
    play: vi.fn(),
    stop: vi.fn(),
    isPlaying: vi.fn((_key: string) => false),
    recorderStart: vi.fn(),
    recorderStop: vi.fn(),
  },
}));

vi.mock('@/hooks/useApi', () => ({
  useVoices: () => ({
    data: h.state.voices,
    isLoading: h.state.voicesLoading,
    isError: h.state.voicesError,
  }),
  useConfig: () => ({ data: h.state.config }),
  useSynthesize: () => ({ mutateAsync: h.spies.synthMutate, isPending: false }),
  useUploadVoice: () => ({ mutateAsync: h.spies.uploadMutate, isPending: false }),
  useDeleteVoice: () => ({ mutateAsync: h.spies.deleteMutate, isPending: false }),
  // 真实实现，确保 handlePreview 产生正确的试听 URL。
  voiceAudioUrl: (id: string) => `/api/voices/${id}/audio`,
}));

vi.mock('@/hooks/useAudioPlayer', () => ({
  useAudioPlayer: () => ({
    playingKey: null,
    play: h.spies.play,
    stop: h.spies.stop,
    isPlaying: h.spies.isPlaying,
  }),
}));

vi.mock('@/hooks/useRecorder', () => ({
  useRecorder: () => ({
    isRecording: h.recorder.isRecording,
    recordingTime: h.recorder.recordingTime,
    error: h.recorder.error,
    start: h.spies.recorderStart,
    stop: h.spies.recorderStop,
  }),
}));

/** 当前 toast 文案列表（用于断言提示信息）。 */
function toastMessages(): string[] {
  return useToastStore.getState().toasts.map((t) => t.message);
}

beforeEach(() => {
  h.spies.synthMutate.mockReset();
  h.spies.synthMutate.mockResolvedValue({ success: true, output_path: 'out.wav', error: null });
  h.spies.uploadMutate.mockReset();
  h.spies.uploadMutate.mockResolvedValue({
    id: 'new',
    name: 'x',
    path: 'assets/datasets/voices/new.wav',
    transcript: '',
    sample_rate: 0,
  });
  h.spies.deleteMutate.mockReset();
  h.spies.deleteMutate.mockResolvedValue({ success: true });
  h.spies.play.mockReset();
  h.spies.play.mockResolvedValue(undefined);
  h.spies.stop.mockReset();
  h.spies.isPlaying.mockReset();
  h.spies.isPlaying.mockReturnValue(false);
  h.spies.recorderStart.mockReset();
  h.spies.recorderStart.mockResolvedValue(undefined);
  h.spies.recorderStop.mockReset();
  h.spies.recorderStop.mockResolvedValue(null);

  h.recorder.isRecording = false;
  h.recorder.recordingTime = 0;
  h.recorder.error = null;

  h.state.voices = [
    { id: 'jyy', name: '佳怡音色', path: '/voices/jyy.wav', transcript: '你好世界', sample_rate: 24000, duration_seconds: 4.2 },
    { id: 'narrator', name: '旁白君', path: '/voices/narrator.wav', transcript: null, sample_rate: 16000 },
  ];
  h.state.voicesLoading = false;
  h.state.voicesError = false;
  // current_models.tts 优先；同时提供兼容字段 current_tts_model。
  h.state.config = { current_models: { tts: 'tts/cosyvoice3' }, current_tts_model: 'tts/cosyvoice3' };

  // 清空 toast，保证测试间隔离。
  useToastStore.setState({ toasts: [] });
});

// ===================================================================
// 语音合成 Tab（既有用例 + 任务 15 无回归）
// ===================================================================

/** 切到「语音合成」tab 并输入合成文本，返回 textarea。 */
async function gotoSynthTabWithText(text: string) {
  // 桌面/移动两处都渲染「语音合成」按钮，点第一个即可切换 activeTab。
  fireEvent.click(screen.getAllByText('语音合成')[0]);
  const textarea = await screen.findByPlaceholderText('输入要合成的文本...');
  fireEvent.change(textarea, { target: { value: text } });
  return textarea;
}

describe('VoiceStudioPage 语音合成', () => {
  it('提交合成请求体包含 model_id/ref_audio/ref_text，且不含 cfg/timesteps/seed/mode (Req 5.1/5.2)', async () => {
    render(<VoiceStudioPage />);
    await gotoSynthTabWithText('测试合成文本');

    fireEvent.click(screen.getByText('开始合成'));

    await waitFor(() => expect(h.spies.synthMutate).toHaveBeenCalledTimes(1));
    const arg = h.spies.synthMutate.mock.calls[0][0];

    // 默认选中第一个音色（jyy），ref 来自该 voice。
    expect(arg).toMatchObject({
      text: '测试合成文本',
      modelId: 'tts/cosyvoice3', // → 请求体 model_id (Current_TTS_Model)
      refAudio: '/voices/jyy.wav', // → 请求体 ref_audio (voice.path)
      refText: '你好世界', // → 请求体 ref_text (voice.transcript)
    });

    // 不含任何 VoxCPM 专有字段。
    expect(arg).not.toHaveProperty('cfg');
    expect(arg).not.toHaveProperty('timesteps');
    expect(arg).not.toHaveProperty('seed');
    expect(arg).not.toHaveProperty('mode');
    // 提交入参仅限这四个键。
    expect(Object.keys(arg).sort()).toEqual(['modelId', 'refAudio', 'refText', 'text']);
  });

  it('所选音色的 path/transcript 作为 ref_audio/ref_text 提交 (Req 5.2/5.4)', async () => {
    render(<VoiceStudioPage />);
    await gotoSynthTabWithText('占位');

    // 选择第二个音色（旁白君，transcript 为 null）。
    fireEvent.click(screen.getByText('旁白君'));
    fireEvent.click(screen.getByText('开始合成'));

    await waitFor(() => expect(h.spies.synthMutate).toHaveBeenCalledTimes(1));
    const arg = h.spies.synthMutate.mock.calls[0][0];
    expect(arg.refAudio).toBe('/voices/narrator.wav');
    // transcript 为 null 时 ref_text 映射为空串。
    expect(arg.refText).toBe('');
  });

  it('model_id 在缺少 current_models 时回退到兼容字段 current_tts_model (Req 5.2)', async () => {
    h.state.config = { current_tts_model: 'tts/legacy-model' };
    render(<VoiceStudioPage />);
    await gotoSynthTabWithText('回退测试');

    fireEvent.click(screen.getByText('开始合成'));

    await waitFor(() => expect(h.spies.synthMutate).toHaveBeenCalledTimes(1));
    expect(h.spies.synthMutate.mock.calls[0][0].modelId).toBe('tts/legacy-model');
  });

  it('文本为空时不发起合成请求 (Req 6.7 等待/防重)', async () => {
    render(<VoiceStudioPage />);
    fireEvent.click(screen.getAllByText('语音合成')[0]);
    await screen.findByPlaceholderText('输入要合成的文本...');

    fireEvent.click(screen.getByText('开始合成'));

    // 给异步处理一点时间，确认未触发提交。
    await new Promise((r) => setTimeout(r, 0));
    expect(h.spies.synthMutate).not.toHaveBeenCalled();
  });
});

// ===================================================================
// 声音克隆 Tab（任务 13.1）
// ===================================================================

/** 切换到「声音克隆」tab。 */
function gotoCloneTab() {
  fireEvent.click(screen.getAllByText('声音克隆')[0]);
}

/** 在声音克隆 tab 选择一个本地音频文件。 */
function pickAudioFile(name = 'sample.wav', type = 'audio/wav') {
  const file = new File(['fake-audio-bytes'], name, { type });
  const input = screen.getByLabelText('选择音频文件') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

describe('VoiceStudioPage 声音克隆 Tab', () => {
  it('提供选择文件/录音/名称/参考文本/创建控件 (Req 1.1)', () => {
    render(<VoiceStudioPage />);
    gotoCloneTab();

    expect(screen.getByText('选择文件')).toBeInTheDocument();
    expect(screen.getByText('开始录音')).toBeInTheDocument();
    expect(screen.getByLabelText('选择音频文件')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/给这个音色起个名字/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/输入参考音频对应的文本内容/)).toBeInTheDocument();
    expect(screen.getByText('创建音色')).toBeInTheDocument();
  });

  it('选本地文件后提交以 multipart 字段 audio/name/transcript 调用上传 (Req 1.2)', async () => {
    render(<VoiceStudioPage />);
    gotoCloneTab();

    pickAudioFile('sample.wav');
    fireEvent.change(screen.getByPlaceholderText(/给这个音色起个名字/), { target: { value: '我的音色' } });
    fireEvent.change(screen.getByPlaceholderText(/输入参考音频对应的文本内容/), { target: { value: '参考文本内容' } });
    fireEvent.click(screen.getByText('创建音色'));

    await waitFor(() => expect(h.spies.uploadMutate).toHaveBeenCalledTimes(1));
    const arg = h.spies.uploadMutate.mock.calls[0][0];
    expect(arg.name).toBe('我的音色');
    expect(arg.transcript).toBe('参考文本内容');
    expect(arg.filename).toBe('sample.wav');
    // audio 字段为 Blob（File 继承自 Blob），对应 multipart 的 `audio` 文件字段。
    expect(arg.audio).toBeInstanceOf(Blob);
  });

  it('录音提交携带录制 Blob 与 name/transcript (Req 1.3)', async () => {
    const recordedBlob = new Blob(['recorded-pcm'], { type: 'audio/webm' });
    h.recorder.isRecording = true; // 模拟正在录音，点击按钮即停止
    h.spies.recorderStop.mockResolvedValue(recordedBlob);

    render(<VoiceStudioPage />);
    gotoCloneTab();

    // isRecording 时按钮显示「停止录音」，点击触发 recorder.stop() 得到 Blob。
    fireEvent.click(screen.getByText('停止录音'));
    await waitFor(() => expect(h.spies.recorderStop).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByPlaceholderText(/给这个音色起个名字/), { target: { value: '录音音色' } });
    fireEvent.click(screen.getByText('创建音色'));

    await waitFor(() => expect(h.spies.uploadMutate).toHaveBeenCalledTimes(1));
    const arg = h.spies.uploadMutate.mock.calls[0][0];
    expect(arg.name).toBe('录音音色');
    expect(arg.filename).toBe('recording.webm');
    expect(arg.audio).toBeInstanceOf(Blob);
    expect(arg.audio).toBe(recordedBlob);
  });

  it('无音频即提交：不调用上传并提示需要音频 (Req 6.1)', async () => {
    render(<VoiceStudioPage />);
    gotoCloneTab();

    // 即使已填名称，缺音频也应被拦截（独立于名称/文本）。
    fireEvent.change(screen.getByPlaceholderText(/给这个音色起个名字/), { target: { value: '仅有名称' } });
    fireEvent.click(screen.getByText('创建音色'));

    await new Promise((r) => setTimeout(r, 0));
    expect(h.spies.uploadMutate).not.toHaveBeenCalled();
    expect(toastMessages()).toContain('请先选择或录制音频');
  });

  it('无名称即提交：不调用上传并提示需要名称 (Req 6.2)', async () => {
    render(<VoiceStudioPage />);
    gotoCloneTab();

    pickAudioFile('sample.wav');
    // 不填名称直接提交。
    fireEvent.click(screen.getByText('创建音色'));

    await new Promise((r) => setTimeout(r, 0));
    expect(h.spies.uploadMutate).not.toHaveBeenCalled();
    expect(toastMessages()).toContain('请填写音色名称');
  });

  it('上传成功后重置表单 (Req 1.8)', async () => {
    render(<VoiceStudioPage />);
    gotoCloneTab();

    pickAudioFile('sample.wav');
    const nameInput = screen.getByPlaceholderText(/给这个音色起个名字/) as HTMLInputElement;
    const transcriptInput = screen.getByPlaceholderText(/输入参考音频对应的文本内容/) as HTMLTextAreaElement;
    fireEvent.change(nameInput, { target: { value: '我的音色' } });
    fireEvent.change(transcriptInput, { target: { value: '参考文本' } });

    // 提交前已选音频提示存在。
    expect(screen.getByText(/已选音频/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('创建音色'));

    await waitFor(() => expect(h.spies.uploadMutate).toHaveBeenCalledTimes(1));
    // 成功后名称/参考文本清空，已选音频提示消失。
    await waitFor(() => expect(nameInput.value).toBe(''));
    expect(transcriptInput.value).toBe('');
    expect(screen.queryByText(/已选音频/)).not.toBeInTheDocument();
    expect(toastMessages()).toContain('音色创建成功');
  });

  it('上传失败展示后端返回的 error 文本 (Req 6.5)', async () => {
    h.spies.uploadMutate.mockRejectedValue({ response: { data: { error: '不支持的音频格式: .txt' } } });

    render(<VoiceStudioPage />);
    gotoCloneTab();

    pickAudioFile('bad.txt', 'text/plain');
    fireEvent.change(screen.getByPlaceholderText(/给这个音色起个名字/), { target: { value: '坏文件' } });
    fireEvent.click(screen.getByText('创建音色'));

    await waitFor(() => expect(h.spies.uploadMutate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toastMessages()).toContain('不支持的音频格式: .txt'));
  });
});

// ===================================================================
// 声音库 Tab（任务 14.1）
// ===================================================================

describe('VoiceStudioPage 声音库 Tab', () => {
  it('展示每条音色的 name/transcript/sample_rate (Req 3.1)', () => {
    render(<VoiceStudioPage />); // 默认即「声音库」tab

    expect(screen.getByText('佳怡音色')).toBeInTheDocument();
    expect(screen.getByText('你好世界')).toBeInTheDocument(); // transcript
    expect(screen.getByText('24000 Hz')).toBeInTheDocument(); // sample_rate
    expect(screen.getByText('旁白君')).toBeInTheDocument();
  });

  it('存在 duration_seconds 时展示时长，缺失时不展示 (Req 3.2)', () => {
    render(<VoiceStudioPage />);

    // jyy 有 duration_seconds=4.2 → 展示 '4.2 s'。
    expect(screen.getByText('4.2 s')).toBeInTheDocument();
    // narrator 无 duration → 不应出现任何时长徽标（仅一个时长被渲染）。
    const durationBadges = screen.queryAllByText(/^\d+(\.\d+)?\s?s$|^\d+:\d{2}$/);
    expect(durationBadges).toHaveLength(1);
  });

  it('加载中展示加载态 (Req 3.3)', () => {
    h.state.voicesLoading = true;
    h.state.voices = [];
    render(<VoiceStudioPage />);

    expect(screen.getByText('正在加载音色...')).toBeInTheDocument();
  });

  it('音色库为空展示空态 (Req 3.4)', () => {
    h.state.voices = [];
    render(<VoiceStudioPage />);

    expect(screen.getByText('暂无可用音色')).toBeInTheDocument();
  });

  it('useVoices 出错展示错误提示并退出加载态 (Req 6.6)', () => {
    h.state.voicesLoading = false;
    h.state.voicesError = true;
    h.state.voices = [];
    render(<VoiceStudioPage />);

    expect(screen.getByText('音色库加载失败，请稍后重试')).toBeInTheDocument();
    expect(screen.queryByText('正在加载音色...')).not.toBeInTheDocument();
  });

  it('试听以 voiceAudioUrl(id) 调用 player.play (Req 3.5)', () => {
    render(<VoiceStudioPage />);

    // isPlaying 全 false → 两条均显示「试听」。
    const previewButtons = screen.getAllByTitle('试听');
    fireEvent.click(previewButtons[0]); // jyy

    expect(h.spies.play).toHaveBeenCalledWith('voice-jyy', '/api/voices/jyy/audio');
  });

  it('试听播放中再次点击同条目触发 toggle 停止 (Req 3.8)', () => {
    // 模拟 jyy 正在播放：按钮显示「停止」，再次点击交由 player.play 内部 toggle。
    h.spies.isPlaying.mockImplementation((key: string) => key === 'voice-jyy');
    render(<VoiceStudioPage />);

    const stopButton = screen.getByTitle('停止试听'); // jyy 正在播放
    fireEvent.click(stopButton);

    // toggle 由 useAudioPlayer.play 同 key 实现，此处断言以相同 key/url 调用。
    expect(h.spies.play).toHaveBeenCalledWith('voice-jyy', '/api/voices/jyy/audio');
    expect(screen.getByText('停止')).toBeInTheDocument();
  });

  it('删除先二次确认，确认前不调用 Delete (Req 4.1)', () => {
    render(<VoiceStudioPage />);

    const deleteButtons = screen.getAllByTitle('删除音色');
    fireEvent.click(deleteButtons[0]); // jyy

    // 出现二次确认，且尚未调用删除。
    expect(screen.getByText('确认删除?')).toBeInTheDocument();
    expect(h.spies.deleteMutate).not.toHaveBeenCalled();
  });

  it('二次确认中确认删除调用 useDeleteVoice 并传入 id (Req 4.2)', async () => {
    render(<VoiceStudioPage />);

    fireEvent.click(screen.getAllByTitle('删除音色')[0]); // jyy
    fireEvent.click(screen.getByTitle('确认删除'));

    await waitFor(() => expect(h.spies.deleteMutate).toHaveBeenCalledTimes(1));
    expect(h.spies.deleteMutate).toHaveBeenCalledWith('jyy');
  });

  it('二次确认中取消不调用 Delete 且保留条目 (Req 4.3)', async () => {
    render(<VoiceStudioPage />);

    fireEvent.click(screen.getAllByTitle('删除音色')[0]); // jyy
    fireEvent.click(screen.getByTitle('取消'));

    await new Promise((r) => setTimeout(r, 0));
    expect(h.spies.deleteMutate).not.toHaveBeenCalled();
    expect(screen.queryByText('确认删除?')).not.toBeInTheDocument();
    // 条目仍在。
    expect(screen.getByText('佳怡音色')).toBeInTheDocument();
  });
});
