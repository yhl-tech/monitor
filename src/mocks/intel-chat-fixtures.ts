// Mock fixtures that mirror the screenshot UI.
// Replace with real API / SSE responses once interfaces are confirmed.

import type {
  AssistantMessage,
  ChatMessage,
  ChatSession,
  QuotaInfo,
} from '@/types/intel-chat';

export const MOCK_QUOTA: QuotaInfo = {
  used: 47,
  total: 100,
  resetsAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
};

export const MOCK_SITREP_TITLE = 'South China Sea / Taiwan';

export const MOCK_SITREP_TIMESTAMP = '2026-03-25T14:23:00Z';

export const MOCK_INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: 'msg-001',
    role: 'user',
    content: '分析南海军演对台海局势的影响',
    timestamp: Date.now() - 90_000,
  } satisfies ChatMessage,
  buildAssistantMessage(),
];

function buildAssistantMessage(): AssistantMessage {
  return {
    id: 'msg-002',
    role: 'assistant',
    content:
      '根据公开卫星影像及航行数据分析，中国海军近期在南海进行的演习呈现出几个值得关注的动向。',
    chainOfThought: {
      collapsed: true,
      steps: [
        '检索南海 AISHIPS 数据，确认过去72小时内有三支水面作战群进入演习区域',
        '对比台海军事飞行活动密度，较上周均值上升约34%',
        '交叉验证 GDELT 媒体事件数据，近期涉台报道语调偏紧张',
        '综合判断：此次演习具备多域协调特征，信息侧配合密度高于往常',
      ],
    },
    dataSources: [
      { label: 'AISHIPS · Vessel Tracking', snippet: '72h 内 3 CSG 进入演习坐标区' },
      { label: 'FlightRadar24 · Taiwan ADIZ', snippet: '军用航班密度 +34% vs 上周均值' },
      { label: 'GDELT Events DB', snippet: '"台湾" 语调紧张度指数 72/100' },
      { label: 'Sentinel-2 · Satellite', snippet: '海南岛军港舰艇数量较基准增加 40%' },
    ],
    sitrep: {
      title: MOCK_SITREP_TITLE,
      generatedAt: MOCK_SITREP_TIMESTAMP,
      classification: 'UNCLASSIFIED',
      bluf: '此次演习具备多域协调特征，信息侧配合密度高于往常。建议在台海方向保持监视频率加倍。',
      overallSeverity: 'MODERATE',
      sections: [
        {
          heading: '事件概述',
          body: '2026年3月24日至25日，中国海军在南海划设演习禁区，范围覆盖西沙群岛至南沙群岛一线。演习同步期间，台湾空军在西南空域活动频率显著上升。',
        },
        {
          heading: '关键数据',
          body: '水面作战群：3支（航母1艘、驱护舰7艘、补给舰2艘）\n空中活动：军用航班 +34%（较上周）\n媒体语调紧张度：72/100（GDELT）\n卫星可见舰艇增量：+40%（海南岛锚地）',
        },
        {
          heading: '评估',
          body: '此次演习与2024年联合利剑-B在模式上高度相似，但信息侧（媒体管控、网络舆情）协同节奏更快，疑似演练"冷启动"信息压制流程。',
        },
      ],
    },
    modelInfo: {
      name: 'deepseek-chat',
      provider: 'deepseek',
      latencyMs: 1240,
      tokensUsed: 892,
    },
    timestamp: Date.now() - 60_000,
  };
}

export const MOCK_SESSIONS: ChatSession[] = [
  {
    id: 'session-001',
    title: '南海军演对台海局势的影响',
    messages: MOCK_INITIAL_MESSAGES,
    createdAt: Date.now() - 120_000,
    updatedAt: Date.now() - 60_000,
  },
  {
    id: 'session-002',
    title: '朝鲜核导活动最新动向',
    messages: [
      {
        id: 'msg-101',
        role: 'user',
        content: '近期朝鲜导弹试射情况',
        timestamp: Date.now() - 3_600_000,
      },
      {
        id: 'msg-102',
        role: 'assistant',
        content: '根据公开数据，过去72小时朝鲜进行了...',
        timestamp: Date.now() - 3_500_000,
      },
    ],
    createdAt: Date.now() - 3_600_000,
    updatedAt: Date.now() - 3_500_000,
  },
];

/** Build a follow-up assistant response for streaming simulation. */
export function buildFollowUpResponse(): AssistantMessage {
  return {
    id: `msg-${Date.now()}`,
    role: 'assistant',
    content: '',
    chainOfThought: {
      collapsed: false,
      steps: [
        '检索近期美军太平洋舰队部署数据',
        '交叉对比区域外交事件时间线',
        '综合评估局势走向',
      ],
    },
    dataSources: [
      { label: 'USNI Fleet Tracker', snippet: 'CVN-76 里根号当前位置：关岛' },
      { label: 'GDELT Events DB', snippet: '中美外交接触频率较上月 -15%' },
    ],
    timestamp: Date.now(),
  };
}
