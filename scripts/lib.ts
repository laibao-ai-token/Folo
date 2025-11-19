import { execSync } from "node:child_process"

export const getGitHash = () => {
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim()
  } catch {
    // Silently fail - git hash is not critical for development
    return ""
  }
}
