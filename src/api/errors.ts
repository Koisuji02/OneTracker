export type KeyedProvider = 'tmdb' | 'rawg' | 'omdb' | 'comicvine'

export class ApiKeyMissingError extends Error {
  provider: KeyedProvider

  constructor(provider: KeyedProvider) {
    super(`Missing API key for ${provider}`)
    this.name = 'ApiKeyMissingError'
    this.provider = provider
  }
}
