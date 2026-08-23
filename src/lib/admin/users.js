import { callAdminApi } from './adminApi'

export async function listUsers() {
  const data = await callAdminApi('/api/admin/list-users')
  return data.users
}

export async function inviteUser(email, grantPlatformAdmin = false) {
  return callAdminApi('/api/admin/invite-user', { email, grantPlatformAdmin })
}

export async function setUserBlocked(userId, blocked) {
  return callAdminApi('/api/admin/set-user-blocked', { userId, blocked })
}
