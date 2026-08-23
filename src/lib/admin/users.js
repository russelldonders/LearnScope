import { callAdminApi } from './adminApi'

export async function listUsers() {
  const data = await callAdminApi('listUsers')
  return data.users
}

export async function inviteUser(email, grantPlatformAdmin = false) {
  return callAdminApi('inviteUser', { email, grantPlatformAdmin })
}

export async function setUserBlocked(userId, blocked) {
  return callAdminApi('setUserBlocked', { userId, blocked })
}
