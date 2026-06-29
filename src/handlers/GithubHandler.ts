import { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_REDIRECT_URI } from '../constants';
import { QuestionDifficulty } from '../types/Question';
import { Submission } from '../types/Submission';

type DistributionType = {
  percentile: string;
  value: number;
};

/* ── Tracking Data Types ── */
interface ProblemEntry {
  id: string;
  date: string;
  title: string;
  slug: string;
  topics: string[];
  difficulty: string;
  solutionPath: string;
}

interface TrackingData {
  goal: number;
  startDate: string;
  previousCount: { total: number; easy: number; medium: number; hard: number };
  entries: ProblemEntry[];
}

const TRACKING_START = '<!-- LEETSYNC_TRACKING_START -->';
const TRACKING_END = '<!-- LEETSYNC_TRACKING_END -->';
const DATA_START = '<!-- LEETSYNC_DATA';
const DATA_END = 'LEETSYNC_DATA -->';

const languagesToExtensions: Record<string, string> = {
  Python: '.py',
  Python3: '.py',
  'C++': '.cpp',
  C: '.c',
  Java: '.java',
  'C#': '.cs',
  JavaScript: '.js',
  Javascript: '.js',
  Ruby: '.rb',
  Swift: '.swift',
  Go: '.go',
  Kotlin: '.kt',
  Scala: '.scala',
  Rust: '.rs',
  PHP: '.php',
  TypeScript: '.ts',
  MySQL: '.sql',
  'MS SQL Server': '.sql',
  Oracle: '.sql',
  PostgreSQL: '.sql',
  'C++14': '.cpp',
  'C++17': '.cpp',
  'C++11': '.cpp',
  'C++98': '.cpp',
  'C++03': '.cpp',
  'C++20': '.cpp',
  'C++1z': '.cpp',
  'C++1y': '.cpp',
  'C++1x': '.cpp',
  'C++1a': '.cpp',
  CPP: '.cpp',
  Dart: '.dart',
  Elixir: '.ex',
};
interface GithubUser {
  id: number;
  avatar_url?: string | null;
  url: string;
  login: string;
  /* other user data can be added here, but not needed for now */
}
export default class GithubHandler {
  base_url: string = 'https://api.github.com';
  private client_secret: string | null = GITHUB_CLIENT_SECRET ?? '';
  private client_id: string | null = GITHUB_CLIENT_ID ?? '';
  private redirect_uri: string | null = GITHUB_REDIRECT_URI ?? '';
  private accessToken: string;
  private username: string;
  private repo: string;
  private github_leetsync_subdirectory: string;

  constructor() {
    //inject QuestionHandler dependency
    //fetch github_access_token, github_username, github_leetsync_repo from storage
    //if any of them is not present, throw an error
    this.accessToken = '';
    this.username = '';
    this.repo = '';
    this.github_leetsync_subdirectory = '';

    chrome.storage.sync.get(
      [
        'github_leetsync_token',
        'github_username',
        'github_leetsync_repo',
        'github_leetsync_subdirectory',
      ],
      (result) => {
        if (
          !result.github_leetsync_token ||
          !result.github_username ||
          !result.github_leetsync_repo
        ) {
          console.log('❌ GithubHandler: Missing Github Credentials');
        }
        this.accessToken = result['github_leetsync_token'];
        this.username = result['github_username'];
        this.repo = result['github_leetsync_repo'];
        this.github_leetsync_subdirectory = result['github_leetsync_subdirectory'];
      },
    );
  }
  async loadTokenFromStorage(): Promise<string> {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.get(['github_leetsync_token'], (result) => {
        const token = result['github_leetsync_token'];
        if (!token) {
          console.log('No access token found.');
          chrome.storage.sync.clear();
          resolve('');
        }
        resolve(token);
      });
    });
  }
  async authorize(code: string): Promise<string | null> {
    const access_token = await this.fetchAccessToken(code);
    const user = await this.fetchGithubUser(access_token);
    if (!access_token || !user) return null;
    this.accessToken = access_token;
    this.username = user.login;
    return access_token;
  }
  async fetchGithubUser(token: string): Promise<GithubUser | null> {
    //validate the token
    const response = await fetch(`${this.base_url}/user`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `token ${token}`,
      },
    }).then((response) => response.json());

    if (!response || response.message === 'Bad credentials') {
      console.error('No access token found.');
      chrome.storage.sync.clear();
      return null;
    }

    //set access token in chrome storage
    chrome.storage.sync.set({
      github_leetsync_token: token,
      github_username: response.login,
    });
    return response;
  }
  async fetchAccessToken(code: string) {
    const token = await this.loadTokenFromStorage();

    if (token) return token;

    const tokenUrl = 'https://github.com/login/oauth/access_token';
    const body = {
      code,
      client_id: this.client_id,
      redirect_uri: this.redirect_uri,
      client_secret: this.client_secret,
    };
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    }).then((response) => response.json());

    if (!response || response.message === 'Bad credentials') {
      console.log('No access token found.');
      chrome.storage.sync.clear();
      return;
    }

    chrome.storage.sync.set({ github_leetsync_token: response.access_token }, () => {
      console.log('Saved github access token.');
    });
    return response.access_token;
  }
  async checkIfRepoExists(repo_name: string): Promise<boolean> {
    const trimmedRepoName = repo_name.replace('.git', '').trim();
    if (!trimmedRepoName) return false;
    //check if repo exists in github user's account
    const result = await fetch(`${this.base_url}/repos/${trimmedRepoName}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `token ${await this.loadTokenFromStorage()}`,
      },
    })
      .then((x) => x.json())
      .catch((e) => console.error(e));
    if (result.message === 'Not Found' || result.message === 'Bad credentials') {
      return false;
    }
    return true;
  }
  public getProblemExtension(lang: string) {
    return languagesToExtensions[lang];
  }

  /* Submissions Methods */
  async fileExists(path: string, fileName: string): Promise<string | null> {
    //check if the file exists in the path using the github API
    const url = `https://api.github.com/repos/${this.username}/${this.repo}/contents/${path}/${fileName}`;

    const uploadedFile = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
    })
      .then((x) => x.json())
      .catch((err) => console.log(err));

    if (uploadedFile.message === 'Not Found') {
      return null;
    }
    return uploadedFile.sha;
  }
  async upload(path: string, fileName: string, content: string, commitMessage: string) {
    const sha = await this.fileExists(path, fileName);
    //create a new file with the content
    const url = `https://api.github.com/repos/${this.username}/${this.repo}/contents/${path}/${fileName}`;
    const data = {
      message: commitMessage,
      content: btoa(unescape(encodeURIComponent(content))),
      sha, //if the file already exists, we need to pass the sha of the file otherwise it will be null
    };

    await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    })
      .then((x) => x.json())
      .catch((err) => console.log(err));
  }
  getDifficultyColor(difficulty: QuestionDifficulty) {
    switch (difficulty) {
      case 'Easy':
        return 'brightgreen';
      case 'Medium':
        return 'orange';
      case 'Hard':
        return 'red';
    }
  }
  createDifficultyBadge(difficulty: QuestionDifficulty) {
    return `<img src='https://img.shields.io/badge/Difficulty-${difficulty}-${this.getDifficultyColor(
      difficulty,
    )}' alt='Difficulty: ${difficulty}' />`;
  }
  async createReadmeFile(
    path: string,
    content: string,
    message: string,
    problemSlug: string,
    questionTitle: string,
    difficulty: QuestionDifficulty,
  ) {
    //check if that file already exists
    //if it does, Update the file with the new content
    //if it doesn't, create a new file with the content
    const mdContent = `<h2><a href="https://leetcode.com/problems/${problemSlug}">${questionTitle}</a></h2> ${this.createDifficultyBadge(
      difficulty,
    )}<hr>${content}`;

    await this.upload(path, 'README.md', mdContent, message);
  }
  async createNotesFile(path: string, notes: string, message: string, questionTitle: string) {
    //check if that file already exists
    //if it does, Update the file with the new content
    //if it doesn't, create a new file with the content
    const mdContent = `<h2>${questionTitle} Notes</h2><hr>${notes}`;

    await this.upload(path, 'Notes.md', mdContent, message);
  }
  async createSolutionFile(
    path: string,
    code: string,
    problemName: string, //the code
    lang: string, //.py, .cpp, .java etc
    stats: {
      memory: number;
      memoryDisplay: string;
      memoryPercentile: number;
      runtime: number;
      runtimeDisplay: string;
      runtimePercentile: number;
    },
  ) {
    //check if that file already exists
    //if it does, Update the file with the new content
    //if it doesn't, create a new file with the content
    const msg = `Time: ${stats.runtimeDisplay} (${stats.runtimePercentile.toFixed(2)}%) | Memory: ${
      stats.memoryDisplay
    } (${stats.memoryPercentile.toFixed(2)}%) - LeetSync`;
    await this.upload(path, `${problemName}${lang}`, code, msg);
  }

  /* ── Dashboard & Tracking Methods ── */

  /**
   * Fetches the raw text content and SHA of a file from the GitHub repo.
   */
  async fetchFileContent(
    path: string,
    fileName: string,
  ): Promise<{ content: string; sha: string } | null> {
    const url = `https://api.github.com/repos/${this.username}/${this.repo}/contents/${path}/${fileName}`;
    const result = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
    })
      .then((x) => x.json())
      .catch((err) => {
        console.log(err);
        return null;
      });

    if (!result || result.message === 'Not Found') return null;

    try {
      const decoded = decodeURIComponent(escape(atob(result.content)));
      return { content: decoded, sha: result.sha };
    } catch {
      return null;
    }
  }

  /**
   * Lists directory contents at a given path in the repo.
   */
  async getRepoContents(path: string = ''): Promise<any[]> {
    const url = `https://api.github.com/repos/${this.username}/${this.repo}/contents/${path}`;
    const result = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
    })
      .then((x) => x.json())
      .catch(() => []);

    if (!Array.isArray(result)) return [];
    return result;
  }

  /**
   * Scans existing problem folders to count previously solved problems.
   * Only called on the first run when no tracking section exists yet.
   */
  async countExistingProblems(): Promise<{
    total: number;
    easy: number;
    medium: number;
    hard: number;
  }> {
    const counts = { total: 0, easy: 0, medium: 0, hard: 0 };
    try {
      const basePath = this.github_leetsync_subdirectory || '';
      const contents = await this.getRepoContents(basePath);
      const problemFolders = contents.filter(
        (item: any) => item.type === 'dir' && /^\d+-.+/.test(item.name),
      );

      for (const folder of problemFolders) {
        const readmePath = basePath ? `${basePath}/${folder.name}` : folder.name;
        const readme = await this.fetchFileContent(readmePath, 'README.md');
        if (readme) {
          counts.total++;
          const diffMatch = readme.content.match(/Difficulty-(Easy|Medium|Hard)/i);
          if (diffMatch) {
            const diff = diffMatch[1].toLowerCase() as 'easy' | 'medium' | 'hard';
            counts[diff]++;
          }
        }
      }
    } catch (e) {
      console.log('Error counting existing problems:', e);
    }
    return counts;
  }

  /**
   * Parses the hidden JSON data block from the README tracking section.
   */
  parseTrackingData(readmeContent: string): TrackingData | null {
    const dataStartIdx = readmeContent.indexOf(DATA_START);
    const dataEndIdx = readmeContent.indexOf(DATA_END);
    if (dataStartIdx === -1 || dataEndIdx === -1) return null;

    try {
      const jsonStr = readmeContent.substring(dataStartIdx + DATA_START.length, dataEndIdx).trim();
      return JSON.parse(jsonStr) as TrackingData;
    } catch {
      return null;
    }
  }

  /**
   * Computes current and longest streaks from the list of problem entries.
   */
  computeStreaks(entries: ProblemEntry[]): { current: number; longest: number } {
    if (entries.length === 0) return { current: 0, longest: 0 };

    // Get unique sorted dates (newest first)
    const allDates = entries.map((e) => e.date);
    const uniqueDates = allDates.filter((d, i) => allDates.indexOf(d) === i).sort(
      (a, b) => new Date(b).getTime() - new Date(a).getTime(),
    );

    // Compute current streak (consecutive days ending today or yesterday)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let currentStreak = 0;
    const mostRecentDate = new Date(uniqueDates[0]);
    mostRecentDate.setHours(0, 0, 0, 0);
    const daysSinceLastSolve = Math.floor(
      (today.getTime() - mostRecentDate.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (daysSinceLastSolve <= 1) {
      // Start counting from the most recent date
      currentStreak = 1;
      for (let i = 1; i < uniqueDates.length; i++) {
        const prevDate = new Date(uniqueDates[i - 1]);
        const currDate = new Date(uniqueDates[i]);
        const diff = Math.floor(
          (prevDate.getTime() - currDate.getTime()) / (1000 * 60 * 60 * 24),
        );
        if (diff === 1) {
          currentStreak++;
        } else {
          break;
        }
      }
    }

    // Compute longest streak
    const sortedAsc = [...uniqueDates].sort(
      (a, b) => new Date(a).getTime() - new Date(b).getTime(),
    );
    let longestStreak = 1;
    let tempStreak = 1;
    for (let i = 1; i < sortedAsc.length; i++) {
      const prevDate = new Date(sortedAsc[i - 1]);
      const currDate = new Date(sortedAsc[i]);
      const diff = Math.floor(
        (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (diff === 1) {
        tempStreak++;
        longestStreak = Math.max(longestStreak, tempStreak);
      } else {
        tempStreak = 1;
      }
    }

    return { current: currentStreak, longest: longestStreak };
  }

  /**
   * Formats a date string as "DD Mon YYYY" (e.g., "24 Jun 2026").
   */
  formatDate(dateStr: string): string {
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    const d = new Date(dateStr);
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  }

  /**
   * Returns the emoji prefix for a difficulty level.
   */
  getDifficultyEmoji(difficulty: string): string {
    switch (difficulty) {
      case 'Easy':
        return '🟢';
      case 'Medium':
        return '🟡';
      case 'Hard':
        return '🔴';
      default:
        return '';
    }
  }

  /**
   * Generates the full dashboard + table markdown from tracking data.
   */
  generateDashboardMarkdown(data: TrackingData): string {
    const { entries, previousCount, goal, startDate } = data;

    // Compute totals: previous counts + tracked entries
    const entryCounts = { easy: 0, medium: 0, hard: 0 };
    for (const e of entries) {
      const diff = e.difficulty.toLowerCase() as 'easy' | 'medium' | 'hard';
      if (entryCounts[diff] !== undefined) entryCounts[diff]++;
    }

    const totalEasy = previousCount.easy + entryCounts.easy;
    const totalMedium = previousCount.medium + entryCounts.medium;
    const totalHard = previousCount.hard + entryCounts.hard;
    const totalSolved = totalEasy + totalMedium + totalHard;
    const progress = goal > 0 ? ((totalSolved / goal) * 100).toFixed(1) : '0.0';

    const streaks = this.computeStreaks(entries);

    // Build the markdown
    let md = '';
    md += `${TRACKING_START}\n\n`;

    // Dashboard
    md += `## 🚀 LeetCode Journey Dashboard\n\n`;
    md += `| 📈 Total Solved | 🟢 Easy | 🟡 Medium | 🔴 Hard |\n`;
    md += `|:---:|:---:|:---:|:---:|\n`;
    md += `| **${totalSolved}** | **${totalEasy}** | **${totalMedium}** | **${totalHard}** |\n\n`;

    md += `| 🔥 Current Streak | 🏆 Longest Streak | 📅 Started | 🎯 Goal | 📊 Progress |\n`;
    md += `|:---:|:---:|:---:|:---:|:---:|\n`;
    md += `| **${streaks.current} day${streaks.current !== 1 ? 's' : ''}** `;
    md += `| **${streaks.longest} day${streaks.longest !== 1 ? 's' : ''}** `;
    md += `| **${this.formatDate(startDate)}** `;
    md += `| **${goal} problems** `;
    md += `| **${progress}%** |\n\n`;

    md += `---\n\n`;

    // Problem table
    md += `## 📋 Problems Solved\n\n`;

    if (entries.length === 0) {
      md += `_No problems tracked yet. Solve a problem on LeetCode to get started!_\n\n`;
    } else {
      md += `| # | Date | Problem | Topics | Difficulty | Solution |\n`;
      md += `|---|------|---------|--------|------------|----------|\n`;

      // Entries are stored newest-first
      entries.forEach((entry, index) => {
        const num = entries.length - index;
        const topicBadges = entry.topics.length
          ? entry.topics.map((t) => `\`${t}\``).join(' ')
          : '_—_';
        const emoji = this.getDifficultyEmoji(entry.difficulty);
        md += `| ${num} `;
        md += `| ${this.formatDate(entry.date)} `;
        md += `| [${entry.id}. ${entry.title}](https://leetcode.com/problems/${entry.slug}) `;
        md += `| ${topicBadges} `;
        md += `| ${emoji} ${entry.difficulty} `;
        md += `| [Solution](./${entry.solutionPath}) |\n`;
      });
      md += '\n';
    }

    // Hidden JSON data block for round-tripping
    md += `${DATA_START}\n`;
    md += JSON.stringify(data, null, 2) + '\n';
    md += `${DATA_END}\n\n`;

    md += TRACKING_END;
    return md;
  }

  /**
   * Updates the repo's root README.md with the dashboard and problem tracking table.
   * This creates the 3rd commit after solution file and problem README.
   */
  async updateMainReadme(problemInfo: {
    questionId: string;
    title: string;
    titleSlug: string;
    difficulty: string;
    topics: string[];
    solutionPath: string;
  }): Promise<void> {
    try {
      // Determine the root path (empty string = repo root, or subdirectory)
      const rootPath = this.github_leetsync_subdirectory || '';

      // Fetch current README.md
      const existing = await this.fetchFileContent(rootPath, 'README.md');
      let readmeContent = existing?.content || '';

      // Today's date in YYYY-MM-DD format (for data storage)
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

      // Parse existing tracking data or initialize
      let trackingData = this.parseTrackingData(readmeContent);

      if (!trackingData) {
        // First run — scan existing folders to get counts
        console.log('📊 First run: scanning existing problems...');
        const existingCounts = await this.countExistingProblems();

        trackingData = {
          goal: 300,
          startDate: todayStr,
          previousCount: existingCounts,
          entries: [],
        };
      }

      // Check for duplicate (same slug already tracked)
      const alreadyTracked = trackingData.entries.some(
        (e) => e.slug === problemInfo.titleSlug,
      );

      if (!alreadyTracked) {
        // Prepend new entry (newest first)
        const newEntry: ProblemEntry = {
          id: problemInfo.questionId,
          date: todayStr,
          title: problemInfo.title,
          slug: problemInfo.titleSlug,
          topics: problemInfo.topics,
          difficulty: problemInfo.difficulty,
          solutionPath: problemInfo.solutionPath,
        };
        trackingData.entries.unshift(newEntry);
      }

      // Generate the new tracking section markdown
      const trackingMarkdown = this.generateDashboardMarkdown(trackingData);

      // Splice it into the README
      const startIdx = readmeContent.indexOf(TRACKING_START);
      const endIdx = readmeContent.indexOf(TRACKING_END);

      if (startIdx !== -1 && endIdx !== -1) {
        // Replace existing tracking section
        readmeContent =
          readmeContent.substring(0, startIdx) +
          trackingMarkdown +
          readmeContent.substring(endIdx + TRACKING_END.length);
      } else {
        // Append tracking section at the bottom
        readmeContent = readmeContent.trimEnd() + '\n\n' + trackingMarkdown + '\n';
      }

      // Commit the updated README
      const commitMsg = `Updated README - Solved ${problemInfo.title} on ${this.formatDate(todayStr)} 🎯 - LeetSync`;

      // Use the upload method (handles create/update via SHA)
      await this.upload(rootPath, 'README.md', readmeContent, commitMsg);

      console.log('✅ Main README updated with dashboard and tracking table');
    } catch (e) {
      console.error('❌ Failed to update main README:', e);
    }
  }

  async submit(
    submission: Submission, //todo: define the submission type
  ): Promise<boolean> {
    if (!this.accessToken || !this.username || !this.repo) return false;
    const {
      code,
      memory,
      memoryDisplay,
      memoryPercentile,
      runtime,
      runtimePercentile,
      runtimeDisplay,
      runtimeDistribution,
      lang,
      statusCode,
      question,
      notes,
    } = submission;

    if (statusCode !== 10) {
      //failed submission
      console.log('❌ Failed Attempt');
      return false;
    }
    //create a path for the files to be uploaded
    let basePath = `${question.questionFrontendId ?? question.questionId ?? 'unknown'}-${question.titleSlug}`;

    if (this.github_leetsync_subdirectory) {
      basePath = `${this.github_leetsync_subdirectory}/${basePath}`;
    }

    const { title, titleSlug, content, difficulty, questionId } = question;

    const langExtension = this.getProblemExtension(lang.verboseName);

    if (!langExtension) {
      console.log('❌ Language not supported');
      return false;
    }
    await this.createReadmeFile(
      basePath,
      content,
      `Added README.md file for ${title}`,
      titleSlug,
      title,
      difficulty,
    );
    if (notes && notes?.length) {
      await this.createNotesFile(basePath, notes, `Added Notes.md file for ${title}`, titleSlug);
    }

    await this.createSolutionFile(basePath, code, question.titleSlug, langExtension, {
      memory,
      memoryDisplay,
      memoryPercentile,
      runtime,
      runtimeDisplay,
      runtimePercentile,
    });

    const todayTimestamp = Date.now();

    chrome.storage.sync.set({
      lastSolved: { slug: titleSlug, timestamp: todayTimestamp },
    });

    //update the problems solved
    const { problemsSolved } = (await chrome.storage.sync.get('problemsSolved')) ?? {
      problemsSolved: [],
    }; //{slug: {...info}}

    chrome.storage.sync.set({
      problemsSolved: {
        ...problemsSolved,
        [titleSlug]: {
          question: {
            difficulty,
            questionId,
          },
          timestamp: todayTimestamp,
        },
      },
    });

    // 3rd commit: Update main README with dashboard and tracking table
    const topicNames = question.topicTags?.map((t) => t.name) ?? [];
    const solutionFilePath = `${basePath}/${question.titleSlug}${langExtension}`;

    await this.updateMainReadme({
      questionId: question.questionFrontendId ?? question.questionId ?? 'unknown',
      title,
      titleSlug,
      difficulty,
      topics: topicNames,
      solutionPath: solutionFilePath,
    });

    return true;
  }
}
