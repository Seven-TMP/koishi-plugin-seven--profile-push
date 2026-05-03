import { Context, Schema, Logger, Session } from 'koishi'

export const name = 'seventmp-profile-push'

export const usage = `## Seven欧卡教程网 主页推送

监控 Seven欧卡教程网 主页最新帖子并推送到指定群聊。

### 群内指令
- \`ets推送状态\` — 查看当前群的推送状态（所有人可用）
- \`ets推送开启\` — 开启当前群的推送（需要管理员权限）
- \`ets推送关闭\` — 关闭当前群的推送（需要管理员权限）
- \`ets推送检查\` — 立即检查一次最新帖子（需要管理员权限）
`

// ========== 配置定义 ==========

export interface Config {
  ownerQQs: string
  profileUrl: string
  postApiUrl: string
  checkIntervalSeconds: number
  enabledGroups: string[]
}

export const Config: Schema<Config> = Schema.object({
  ownerQQs: Schema.string()
    .default('')
    .description('主人QQ，多个用英文逗号分隔'),
  profileUrl: Schema.string()
    .default('https://ets2.seventmp.cn/profile/13')
    .description('用户主页地址'),
  postApiUrl: Schema.string()
    .default('https://ets2.seventmp.cn/api/users/13/posts?page=1&limit=1')
    .description('帖子接口地址，返回 JSON 格式'),
  checkIntervalSeconds: Schema.number()
    .min(10)
    .default(60)
    .description('检查间隔（秒），最小 10 秒'),
  enabledGroups: Schema.array(Schema.string())
    .default([])
    .description('启用推送的群号列表'),
})

// ========== 内部类型 ==========

interface LatestPost {
  title: string
  url: string
}

interface PersistState {
  lastPostUrl: string
  lastPostTitle: string
  lastCheckTime: number
}

// ========== 插件主体 ==========

const logger = new Logger(name)

export function apply(ctx: Context, config: Config) {
  // 持久化状态（运行时内存中维护）
  const state: PersistState = {
    lastPostUrl: '',
    lastPostTitle: '',
    lastCheckTime: 0,
  }

  let checking = false
  let timer: ReturnType<typeof setInterval> | null = null

  // ---------- 工具函数 ----------

  function normalizeInterval(): number {
    return Math.max(10, config.checkIntervalSeconds || 60)
  }

  function getOwnerSet(): Set<string> {
    return new Set(
      String(config.ownerQQs || '')
        .split(/[,\n，]/)
        .map(s => s.trim())
        .filter(Boolean),
    )
  }

  function isGroupEnabled(groupId: string): boolean {
    return config.enabledGroups.includes(groupId)
  }

  function enableGroup(groupId: string): void {
    if (!config.enabledGroups.includes(groupId)) {
      config.enabledGroups.push(groupId)
    }
  }

  function disableGroup(groupId: string): void {
    const idx = config.enabledGroups.indexOf(groupId)
    if (idx >= 0) config.enabledGroups.splice(idx, 1)
  }

  function isAdminUser(session: Session): boolean {
    const userId = session.userId ?? ''
    if (getOwnerSet().has(userId)) return true
    // Koishi 中 session.author?.roles 包含用户角色信息
    const roles = (session.author as any)?.roles as string[] | undefined
    if (roles) {
      if (roles.includes('owner') || roles.includes('admin')) return true
    }
    // OneBot 协议的 role 字段
    const role = (session as any).event?.member?.roles?.[0]
      ?? (session as any).onebot?.sender?.role
      ?? ''
    return role === 'owner' || role === 'admin'
  }

  function decodeHtml(input: string): string {
    return input
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim()
  }

  // ---------- API 请求 ----------

  async function fetchLatestPost(): Promise<LatestPost | null> {
    const requestUrl = String(config.postApiUrl || '').trim()
    if (!requestUrl) {
      logger.warn('获取帖子失败: 未配置接口地址')
      return null
    }

    try {
      const response = await ctx.http.get(requestUrl, {
        headers: { Accept: 'application/json' },
      })

      const data = response as Record<string, unknown>

      let posts: any[] = []
      if (Array.isArray(data.data)) {
        posts = data.data
      } else if (data.data && typeof data.data === 'object') {
        const root = data.data as Record<string, unknown>
        if (Array.isArray(root.list)) posts = root.list as any[]
        else if (Array.isArray(root.items)) posts = root.items as any[]
      } else if (Array.isArray(data.list)) {
        posts = data.list as any[]
      }

      if (!posts.length) {
        logger.warn(`${requestUrl} -> 返回数据中没有帖子`)
        return null
      }

      const post = posts[0] ?? {}
      const title = decodeHtml(String(post.title ?? '')) || '[无标题]'
      const postId = post.id
      const url = postId !== undefined && postId !== null
        ? `https://ets2.seventmp.cn/post/${postId}`
        : (post.url || post.link || config.profileUrl)

      return { title, url }
    } catch (error) {
      logger.warn(`获取帖子失败: ${requestUrl} -> ${String(error)}`)
      return null
    }
  }

  // ---------- 推送逻辑 ----------

  function buildPostMessage(post: LatestPost): string {
    return [post.title, post.url].join('\n')
  }

  function buildStatusMessage(groupId: string): string {
    const lastCheck = state.lastCheckTime
      ? new Date(state.lastCheckTime).toLocaleString('zh-CN', {
          hour12: false,
          timeZone: 'Asia/Shanghai',
        })
      : '暂无'

    return [
      '[Seven欧卡教程网 推送状态]',
      `当前群推送: ${isGroupEnabled(groupId) ? '已开启' : '未开启'}`,
      `检查间隔: ${normalizeInterval()} 秒`,
      `接口地址: ${config.postApiUrl}`,
      `最后检查: ${lastCheck}`,
      `最后帖子: ${state.lastPostTitle || '暂无'}`,
      `帖子链接: ${state.lastPostUrl || config.profileUrl}`,
    ].join('\n')
  }

  async function broadcastToGroups(
    targetGroups: string[],
    message: string,
  ): Promise<void> {
    for (const bot of ctx.bots) {
      for (const groupId of targetGroups) {
        try {
          await bot.sendMessage(groupId, message)
        } catch (error) {
          logger.warn(`推送到群 ${groupId} 失败: ${String(error)}`)
        }
      }
    }
  }

  async function checkLatestPostAndNotify(
    manualGroupId?: string,
  ): Promise<{ updated: boolean; post?: LatestPost | null; reason?: string }> {
    if (checking) {
      return { updated: false, reason: '正在检查中，请稍后再试' }
    }

    checking = true
    try {
      const latest = await fetchLatestPost()
      state.lastCheckTime = Date.now()

      if (!latest) {
        return { updated: false, reason: '获取最新帖子失败' }
      }

      const changed =
        latest.url !== state.lastPostUrl ||
        latest.title !== state.lastPostTitle

      if (!changed) {
        return { updated: false, post: latest, reason: '暂无新帖子' }
      }

      const firstSeen = !state.lastPostUrl && !state.lastPostTitle
      state.lastPostUrl = latest.url
      state.lastPostTitle = latest.title

      if (firstSeen && !manualGroupId) {
        logger.info(`首次启动，已记录当前最新帖子: ${latest.title}`)
        return {
          updated: false,
          post: latest,
          reason: '首次启动，已记录当前最新帖子',
        }
      }

      const targetGroups = manualGroupId
        ? [manualGroupId]
        : [...config.enabledGroups]
      await broadcastToGroups(targetGroups, buildPostMessage(latest))

      return { updated: true, post: latest }
    } finally {
      checking = false
    }
  }

  // ---------- 定时器 ----------

  function resetTimer(): void {
    if (timer) {
      clearInterval(timer)
      timer = null
    }

    const intervalMs = normalizeInterval() * 1000
    timer = setInterval(() => {
      checkLatestPostAndNotify().catch(error => {
        logger.warn(`定时检查异常: ${String(error)}`)
      })
    }, intervalMs)
  }

  // ---------- 注册指令 ----------

  // 使用 middleware 来监听特定文本消息（与原插件行为一致）
  ctx.middleware(async (session, next) => {
    // 只处理群消息
    if (!session.guildId) return next()

    const msg = (session.content ?? '').trim()
    const groupId = session.guildId

    if (msg === 'ets推送状态') {
      await session.send(buildStatusMessage(groupId))
      return
    }

    if (!isAdminUser(session)) return next()

    if (msg === 'ets推送开启') {
      enableGroup(groupId)
      await session.send('[Seven欧卡教程网 推送]\n当前群已开启主页帖子推送')
      return
    }

    if (msg === 'ets推送关闭') {
      disableGroup(groupId)
      await session.send('[Seven欧卡教程网 推送]\n当前群已关闭主页帖子推送')
      return
    }

    if (msg === 'ets推送检查') {
      const result = await checkLatestPostAndNotify(groupId)
      if (result.updated && result.post) return

      const reply = result.post
        ? [
            '[Seven欧卡教程网 推送]',
            result.reason || '检查完成',
            result.post.title,
            result.post.url,
          ].join('\n')
        : ['[Seven欧卡教程网 推送]', result.reason || '检查失败'].join('\n')
      await session.send(reply)
      return
    }

    return next()
  })

  // ---------- 生命周期 ----------

  // 插件启动时初始化定时器并执行首次检查
  ctx.on('ready', () => {
    resetTimer()
    checkLatestPostAndNotify().catch(error => {
      logger.warn(`初始化检查异常: ${String(error)}`)
    })
    logger.info('Seven欧卡教程网 主页推送插件已启动')
  })

  // 插件卸载时清理定时器
  ctx.on('dispose', () => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    logger.info('Seven欧卡教程网 主页推送插件已停止')
  })
}
