# koishi-plugin-seventmp-profile-push

[![npm](https://img.shields.io/npm/v/koishi-plugin-seventmp-profile-push?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-seventmp-profile-push)

监控 Seven欧卡教程网主页最新帖子并推送到指定群聊。

## 功能

- 定时检查最新帖子，发现新帖自动推送到已开启的群
- 群内指令控制推送开关，无需重启
- 通过 Koishi 控制台可视化配置

## 配置项

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `ownerQQs` | `string` | `''` | 主人QQ，多个用英文逗号分隔 |
| `profileUrl` | `string` | `https://ets2.seventmp.cn/profile/13` | 用户主页地址 |
| `postApiUrl` | `string` | `https://ets2.seventmp.cn/api/users/13/posts?page=1&limit=1` | 帖子接口地址 |
| `checkIntervalSeconds` | `number` | `60` | 检查间隔（秒），最小 10 秒 |
| `enabledGroups` | `string[]` | `[]` | 启用推送的群号列表 |

## 群内指令

| 指令 | 权限 | 说明 |
|------|------|------|
| `ets推送状态` | 所有人 | 查看当前群的推送状态 |
| `ets推送开启` | 管理员/主人 | 开启当前群的推送 |
| `ets推送关闭` | 管理员/主人 | 关闭当前群的推送 |
| `ets推送检查` | 管理员/主人 | 立即检查一次最新帖子 |

## 安装

```bash
npm install koishi-plugin-seventmp-profile-push
```

然后在 Koishi 控制台的插件配置中添加并启用本插件。

## 感谢

[鲁班]（https://github.com/suoboge）对本项目的测试
