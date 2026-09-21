/* Chinese for the admin's own interface.
 *
 * The admin edits a bilingual site, but every label, hint and button in it
 * was English — so the person most likely to be editing the Chinese pages
 * was reading an English control panel to do it.
 *
 * Keys are the English source string rather than invented ids like
 * `btn.save`. It keeps the call sites readable (`T('Save draft')` says what
 * it renders) and means this file is the only place the two languages have
 * to be kept level. The cost is that editing an English string orphans its
 * translation — `missing()` at the bottom of this file lists any that have
 * drifted, so run it in the console after changing copy.
 *
 * A missing key falls through to the English, so a half-translated panel is
 * always a working panel. Nothing here reaches the public site: these are
 * the admin's own words, not content.
 *
 * The Chinese is functional, not literary — it is UI chrome, and it should
 * be read by a native speaker before Tony relies on it, the same caveat the
 * site's own Chinese copy carries.
 */

const UI_STRINGS = {
  // ----------------------------------------------------------- the shell
  'site admin': '站点后台',
  'Loading…': '载入中…',
  'Loading content…': '正在载入内容…',
  'Sections': '版块',
  'What changed?': '改动说明',
  'Change note': '改动说明',
  'Reload': '重新载入',
  'Save draft': '保存草稿',
  'Publish': '发布',
  'Sign out': '退出登录',
  'Sign in': '登录',
  'Password': '密码',
  'Interface language': '界面语言',

  // ----------------------------------------------------------- status line
  'unsaved changes': '有未保存的改动',
  'signed in': '已登录',
  'live site is up to date': '线上站点已是最新',
  'edit &amp; preview only': '仅可编辑与预览',
  'Not signed in': '未登录',
  'Not connected': '未连接',
  '{n} change waiting to publish': '{n} 处改动待发布',
  '{n} changes waiting to publish': '{n} 处改动待发布',

  // ----------------------------------------------------------- toasts
  'Saved to the draft branch': '已保存到草稿分支',
  'The site owner can publish it to the live site.': '站点所有者可以将它发布到线上。',
  'Press Publish to put it live.': '点击「发布」即可上线。',
  'Published': '已发布',
  'Cloudflare is rebuilding — the live site updates in a minute or two.':
    'Cloudflare 正在重新构建，线上站点会在一两分钟内更新。',
  'Reloaded from the draft branch': '已从草稿分支重新载入',
  'Signed out.': '已退出登录。',
  'Uploading {name}…': '正在上传 {name}…',
  'Uploaded {path}': '已上传 {path}',
  'It is on the draft branch — Publish to put it on the live site.':
    '文件已在草稿分支，点击「发布」即可上线。',
  'Your changes are still on this page. Open the admin in a new tab, sign in, then come back and press Save draft again.':
    '你的改动仍在本页面上。请在新标签页打开后台并登录，然后回到这里再次点击「保存草稿」。',
  'Could not render this tab: {message}. The Raw JSON tab still works.':
    '无法显示此标签页：{message}。「原始 JSON」标签页仍可使用。',
  'Could not load content: {message}': '无法载入内容：{message}',

  // ----------------------------------------------------------- confirms
  'Remove this item? It disappears from both languages.':
    '要删除这一项吗？中英文两版都会同时删除。',
  'Remove this milestone from both languages?': '要从中英文两版同时删除这条历程吗？',
  'Remove this photo? It disappears from both languages.':
    '要删除这张照片吗？中英文两版都会同时删除。',
  'Remove the Bilibili notice box from the Chinese page?': '要从中文页面移除 B 站提示框吗？',
  'Publish all saved changes to the live site?': '要将所有已保存的改动发布到线上吗？',
  'Reload and discard your unsaved changes?': '重新载入将丢弃未保存的改动，确定吗？',
  'Sign out and discard your unsaved changes?': '退出登录将丢弃未保存的改动，确定吗？',
  'Short name for this milestone (used as its internal id):':
    '这条历程的简短名称（用作内部 id）：',

  // ----------------------------------------------------------- list controls
  'Move up': '上移',
  'Move down': '下移',
  'Earlier': '往前',
  'Later': '往后',
  'Remove': '删除',
  'Replace': '替换',
  'Replace poster': '替换封面图',
  'Replace cover': '替换封面',
  'Replace centre': '替换中心图',
  'Remove column': '删除此栏',
  'Remove paragraph': '删除此段',
  'Remove the notice box': '移除提示框',
  'unknown': '未知',
  'tight': '紧贴',
  'Parsed OK': 'JSON 格式正确',
  'Not valid JSON — {message}': 'JSON 格式有误 — {message}',
  'Double-click to rename': '双击可重命名',
  '+ link': '+ 链接',
  '+ row': '+ 一行',
  '+ item': '+ 一项',
  '+ column': '+ 一栏',
  '+ paragraph': '+ 段落',
  '+ milestone': '+ 一条历程',
  '+ Add a year': '+ 添加年份',
  '+ Add a video': '+ 添加视频',
  '+ Add a release': '+ 添加作品',
  '+ Add a press item': '+ 添加报道',
  '+ Add a photo': '+ 添加照片',
  '+ Add a ring photo': '+ 添加环形照片',

  // ----------------------------------------------------------- homepage
  'Browser tab': '浏览器标签',
  'Search description': '搜索结果描述',
  'Shown on the browser tab and as the headline in search results.':
    '显示在浏览器标签上，也是搜索结果里的标题。',
  'Tab icon': '标签图标',
  'The little picture on the browser tab. A square image works best — it is shown at about 16 pixels, so a crop of the logo reads better than the whole thing.':
    '浏览器标签上的小图片。正方形效果最好 — 它只有大约 16 像素，所以截取标志的一部分比放整个标志更清楚。',
  'Nothing uploaded yet': '尚未上传',
  'Upload': '上传',
  'Header description': '顶部说明',
  'The line above the handwriting, with a dot before it.': '手写字上方的那行字，前面带一个圆点。',
  'Background image': '背景图片',
  'The photograph behind the whole top of the page.': '整个页面顶部背后的照片。',
  'Image description': '图片描述',
  'Describes the photograph for screen readers and for search engines.':
    '供屏幕阅读器和搜索引擎使用的照片描述。',
  'Bio': '简介',
  'The line under the handwriting. <code>&lt;b&gt;…&lt;/b&gt;</code> makes a part of it bold, and <code>&lt;b class="key"&gt;…&lt;/b&gt;</code> makes it the accent colour.':
    '手写字下方的那行字。<code>&lt;b&gt;…&lt;/b&gt;</code> 可以加粗其中一段，<code>&lt;b class="key"&gt;…&lt;/b&gt;</code> 则让它显示为强调色。',
  'Latest': '最新动态',
  'The release line at the foot of the hero.': '首屏底部的发行信息那一行。',
  'Hidden heading': '隐藏标题',
  'The handwriting is an image, so this is the real <code>h1</code> text. It is not shown on the page — it is what a screen reader announces.':
    '手写字是图片，所以这里才是真正的 <code>h1</code> 文字。它不会显示在页面上，而是屏幕阅读器朗读的内容。',
  'Optional, and currently empty: a line between the handwriting and the bio.':
    '可不填，目前为空：位于手写字与简介之间的一行字。',

  'Video title': '视频标题',
  'Small label above the title': '标题上方的小字',
  'Line under the title': '标题下方的一行',
  'Leave empty for no line.': '留空则不显示。',
  'Link to the rest': '查看更多的链接',
  'The way through to the Visuals page from the homepage.': '从首页进入影像作品页的入口。',
  'The part after <code>youtu.be/</code>.': '<code>youtu.be/</code> 后面的那一段。',

  // ----------------------------------------------------------- loop & audio
  'Handwriting loop': '手写字轮播',
  'The handwriting over the photograph. Each picture is drawn on, holds, then wipes off for the next one. With a single picture it simply stays put.':
    '照片上方的手写字。每张图片会逐笔写出、停留，然后擦去换下一张。只有一张时就一直停在那里。',
  'Seconds each picture holds': '每张停留秒数',
  'Nothing in the loop yet.': '轮播中还没有图片。',
  'Remove this picture from the loop?': '要把这张图片从轮播中移除吗？',
  'Drop pictures here, or click to choose': '把图片拖到这里，或点击选择',
  'Drop tracks here, or click to choose': '把音频拖到这里，或点击选择',
  'Audio': '音频',
  'Music for the play button in the hero. Upload the files once, then choose what each language plays — the two are separate lists, so the Chinese page can lead with a different song. mp3, m4a or ogg, up to 8MB each.':
    '首屏播放按钮所播放的音乐。文件只需上传一次，然后分别选择每种语言播放哪些 — 两份列表相互独立，所以中文页可以主打不同的歌曲。支持 mp3、m4a 或 ogg，每个不超过 8MB。',
  'Track title': '曲目名称',
  'Remove this track? It is taken out of both playlists too.':
    '要删除这首曲目吗？它也会从两份播放列表中移除。',
  'Add a track…': '添加曲目…',
  'Plays on the {lang} page': '在{lang}页面播放',
  'Nothing chosen — the player falls back to the synthesised pad.':
    '未选择曲目 — 播放器会退回到合成的环境音。',

  '+{n} more': '还有 {n} 条',

  // ----------------------------------------------------------- preview rail
  'Preview': '预览',
  'No preview for this section yet.': '此版块暂无预览。',
  'Preview unavailable: {message}': '预览不可用：{message}',

  // ----------------------------------------------------------- tab names
  'Tony D': 'Tony D',
  'Music': '音乐作品',
  'Visuals': '影像作品',
  'About': '关于',
  'In the Making': '创作手记',
  'Contact & footer': '联系方式与页脚',
  'Raw JSON': '原始 JSON',

  // ----------------------------------------------------------- shared cards
  'Browser tab & search results': '浏览器标签与搜索结果',
  'Page title': '页面标题',
  'Meta description': '页面描述',
  'Number': '编号',
  'Title': '标题',
  'Description': '描述',
  'Stays on one line when the window is wide enough. Press Enter where you want it to break instead.':
    '窗口够宽时保持一行；如需换行，在想换行的位置按回车。',

  // ----------------------------------------------------------- videos
  'YouTube ID': 'YouTube ID',
  'The part after <code>youtu.be/</code>. Also names the poster file.':
    '<code>youtu.be/</code> 后面的那一段，同时也是封面图的文件名。',
  'Bilibili BV ID': 'B 站 BV 号',
  'Leave empty until the video is on B站.': '视频上传到 B 站之前留空即可。',
  'Subtitle': '副标题',
  'Kicker': '眉题',
  'Small label above the title on the feature tile.': '主打视频标题上方的小字。',
  'Feature tile (large, above the grid)': '主打视频（大图，位于网格上方）',
  'Poster path': '封面图路径',
  'Size in the grid': '在网格中的大小',
  'Language attributes': '语言属性',
  'EN title lang attr': '英文页标题的 lang 属性',
  'Set to <code>zh</code> if this title is Chinese on the English page.':
    '如果英文页上的这个标题是中文，请填 <code>zh</code>。',
  '中文 title lang attr': '中文页标题的 lang 属性',
  'Set to <code>en</code> if this title stays English on the Chinese page.':
    '如果中文页上的这个标题保持英文，请填 <code>en</code>。',
  '(untitled)': '（无标题）',
  'feature': '主打',
  'B站 live': 'B 站已上线',
  'B站 pending': 'B 站待上线',

  // ----------------------------------------------------------- releases
  'Label': '名称',
  'URL': '链接',
  'Links ({locale})': '链接（{locale}）',
  'Leave empty and tick “unknown” to grey it out.': '留空并勾选「未知」即可置灰。',
  'Cover path': '封面路径',
  'Inline HTML is allowed, e.g. <code>&lt;span lang="zh"&gt;想太多&lt;/span&gt;</code>.':
    '可使用行内 HTML，例如 <code>&lt;span lang="zh"&gt;想太多&lt;/span&gt;</code>。',

  '01  Releases': '01  音乐作品',
  '02  Visuals': '02  影像作品',
  '03  About': '03  关于',
  '04  Timeline': '04  创作历程',
  'The videos: the title video at the top of the page, and the grid under the heading.':
    '视频：页面顶部的主打视频，以及标题下方网格里的其余视频。',

  // ----------------------------------------------------------- releases
  'Heading': '标题',
  'The heading and the line under it. You can also double-click either of them in the preview and type straight into it.':
    '版块标题和它下面那行字。也可以在预览里双击它们，直接输入修改。',
  'Tags': '标签',
  '+ tag': '+ 标签',
  'No labels on this cover.': '这张封面上没有标签。',
  'Labels shown over the top-left corner of the cover. Add as many as the record needs.':
    '显示在封面左上角的标签。可以按需要添加多个。',
  'Double-click to edit': '双击可编辑',

  'Open the {tab} tab': '打开「{tab}」标签页',
  'The homepage, top to bottom. Each section under the hero is a trimmed copy of another page — what the homepage shows of it is edited here, and the rest on that page’s own tab.':
    '首页，自上而下。首屏以下的每个版块都是其他页面的精简版：首页显示的部分在这里编辑，其余部分在各自页面的标签页里。',
  'Track lists, the singles by year and each record’s description are on the Music page, not the homepage.':
    '曲目列表、按年份排列的单曲以及每张作品的介绍在「音乐作品」页面，不在首页。',
  'The photo grid and the rest of the videos are on the Visuals page.':
    '照片网格和其余视频在「影像作品」页面。',
  'The bio paragraphs, the full timeline and the press items are on the About page.':
    '简介段落、完整创作历程和媒体报道在「关于」页面。',
  'The timeline itself is on the About page.': '创作历程本身在「关于」页面。',
  'The homepage shows the six most recent entries, newest first. There is nothing to set here — it follows the timeline on the About page, so adding an entry there pushes the oldest one off the homepage by itself.':
    '首页按时间倒序显示最近六条。这里无需设置 — 它跟随「关于」页面的创作历程，在那里新增一条，最旧的一条就会自动从首页移除。',
  'Name': '名称',
  'Kind and date': '类型与日期',
  'The line under the name — <b>Album · 2025</b>, or a range for the singles.':
    '名称下方的那行字 — 例如 <b>Album · 2025</b>，单曲则可填年份区间。',
  'Cover description': '封面描述',
  'Describes the cover for screen readers.': '供屏幕阅读器使用的封面描述。',
  'Photograph': '照片',
  'The portrait beside the profile. The About page uses a different one of its own.':
    '资料表旁边的肖像。「关于」页面另有一张自己的照片。',
  'The line set in large italics beside the photograph.': '照片旁边用大号斜体排出的那句话。',
  'Profile': '资料',
  'Table heading': '表格标题',
  'What the homepage shows': '首页显示的内容',
  'What the homepage shows under the Visuals heading. Whichever you choose is shown at the same width and the same 16:9 shape.':
    '首页「影像作品」标题下显示的内容。无论选哪一种，都会以相同宽度和 16:9 比例显示。',
  'The title video': '主打视频',
  'A picture': '一张图片',
  'Upload a picture below and it takes over from the video.': '在下方上传图片后，它就会取代视频。',
  'This picture is shown instead of the video.': '当前显示这张图片，而不是视频。',
  'Upload a picture here to show it instead of the video.': '在这里上传图片即可取代视频显示。',
  'No picture — the video is shown': '没有图片 — 显示视频',
  'Go back to showing the video?': '要改回显示视频吗？',
  'Use the video instead': '改用视频',

  // ----------------------------------------------------------- visuals
  'Picture under the video': '视频下方的图片',
  'Sits between the title video and the grid, the same width as the video. A wide picture works best. Leave it empty and nothing is shown.':
    '位于主打视频与网格之间，宽度与视频一致。横幅式的宽图效果最好。留空则不显示。',
  'No picture here yet': '这里还没有图片',
  'Describes the picture for screen readers. Leave empty if it is decoration.':
    '供屏幕阅读器使用的图片描述。纯装饰用途可留空。',
  'Remove the picture under the video?': '要移除视频下方的图片吗？',
  'Remove the picture': '移除图片',
  'no picture': '无图片',

  // ----------------------------------------------------------- music tab
  'The record inside': '唱片内页',
  'The track list written around the rim of the record, the one picked out in colour, and the word on the label in the middle. Drag to reorder — the order here is the order round the ring.':
    '写在唱片边缘一圈的曲目列表、用强调色标出的那一首，以及中心标签上的那个词。可拖动排序 — 这里的顺序就是环绕一圈的顺序。',
  'Tracks': '曲目',
  'No tracks on this record yet.': '这张唱片还没有曲目。',
  '+ track': '+ 曲目',
  'Picked out in colour': '用强调色标出',
  'The track that shares its name with the record, usually.': '通常是与唱片同名的那一首。',
  'Word on the label': '标签上的词',
  'The easter egg in the middle of the disc. Leave empty for none.':
    '唱片中心的彩蛋。留空则不显示。',
  'none': '无',
  'Singles by year': '按年份排列的单曲',
  'The list inside the singles card. Newest year first is how it reads on the page — drag a year to move it.':
    '单曲卡片里的列表。页面上按最新年份在前的顺序显示 — 拖动年份即可调整位置。',
  '{n} single': '{n} 首单曲',
  '{n} singles': '{n} 首单曲',
  '(no year)': '（未填年份）',
  'Remove the year': '删除该年份',
  'Years': '年份',
  'Year': '年份',
  'Remove this year and everything in it?': '要删除这一年以及其中的全部内容吗？',
  '+ single': '+ 单曲',
  '+ year': '+ 年份',
  'Mark the selection as the other language': '把选中的部分标记为另一种语言',
  'One language or two. Select the part in the other language and press the <b>EN</b> / <b>中文</b> button — it marks that span, which is what makes a screen reader switch voice and the right typeface load.':
    '可以只用一种语言，也可以两种并列。选中另一种语言的部分，点击 <b>EN</b> / <b>中文</b> 按钮 — 它会标记那一段，这正是让屏幕阅读器切换语音、并加载正确字体的原因。',
  'Bold': '加粗',
  'Italic': '斜体',
  'Underline': '下划线',
  'Remove formatting': '清除格式',
  'Insert a character': '插入字符',
  'Kind and year': '类型与年份',
  'The line under the name — <b>Album · 2025</b>, or a range for the singles. Leave it empty for nothing.':
    '名称下方的那行字 — 例如 <b>Album · 2025</b>，单曲则可填年份区间。留空则不显示。',
  'Publisher': '发行方',
  'Shown after the year on the Music page only, not on the homepage. Leave it empty for nothing.':
    '仅在「音乐作品」页面的年份之后显示，首页不显示。留空则不显示。',

  // ----------------------------------------------------------- about
  'Bio paragraphs': '简介段落',
  'Paragraph': '段落',
  'Quote': '引文',
  'Paragraphs after the quote': '引文之后的段落',
  'Profile table': '资料表',
  'Profile rows ({lang})': '资料行（{lang}）',
  'Term': '项目',
  'Value': '内容',
  'Headings': '小标题',

  'Blurb': '金句',
  'The line set apart from the rest of the bio, between the paragraphs.':
    '夹在段落之间、单独排出来的那句话。',
  'Photograph': '照片',
  'The portrait beside the bio on this page. The homepage uses a different one, edited on its own tab.':
    '本页简介旁边的肖像。首页使用的是另一张，在首页的标签页里编辑。',
  'Posters are kept in this repository on purpose. They used to be hot-linked from i.ytimg.com, which is blocked in mainland China — the Chinese page showed thirteen broken images. Do not paste a YouTube thumbnail URL here.':
    '封面图有意保存在本仓库中。它们过去是从 i.ytimg.com 外链的，而该域名在中国大陆无法访问 — 中文页上曾出现十三张裂图。请不要在这里粘贴 YouTube 缩略图的网址。',
  'Stats': '资料',
  'Stats heading': '资料标题',
  'The table beside the bio. Each row is a label and a value; add and remove as many as you like, and each language keeps its own rows.':
    '简介旁边的表格。每一行由标题和内容组成，可以随意增删，两种语言各自保留自己的行。',

  // ----------------------------------------------------------- milestones
  'Year label': '年份',
  'Highlight as current year': '标为当前年份',
  'English': '英文',
  '中文': '中文',
  '{n} entries': '{n} 条',

  'Entry': '条目',
  'Bold': '加粗',
  'Italic': '斜体',
  'Drag to reorder': '拖动可调整顺序',
  'Show all {n}': '展开全部 {n} 条',
  'Show fewer': '收起',
  'open to edit': '展开编辑',
  'Year colour': '年份颜色',
  'Default': '默认',
  'Using the default': '使用默认颜色',
  'Overrides the colour of the year. The default is the accent green on the current year.':
    '覆盖年份的显示颜色。默认为当前年份使用的强调绿色。',

  // ----------------------------------------------------------- press
  'Link': '链接',
  'Source': '来源',
  'Headline': '标题',
  'Gloss / subtitle': '释义 / 副标题',

  // ----------------------------------------------------------- contact
  'Shared': '通用',
  'Contact email': '联系邮箱',
  'Copyright year': '版权年份',
  'Contact heading': '联系版块标题',
  'Who to contact': '联系对象',
  'Message window': '留言窗口',
  'Button': '按钮',
  'Window title': '窗口标题',
  'Introduction': '引导文字',
  'Message label': '留言框标签',
  'Name label': '姓名标签',
  'Name hint': '姓名提示',
  'Email/phone label': '邮箱／电话标签',
  'Email/phone hint': '邮箱／电话提示',
  'Send button': '发送按钮',
  'Cancel button': '取消按钮',
  'Close button (screen readers)': '关闭按钮（屏幕阅读器）',
  'While sending': '发送中提示',
  'After sending': '发送成功提示',
  'If it fails': '发送失败提示',
  'No message written': '未填写留言提示',
  'No email or phone': '未填写邮箱或电话提示',
  'Column heading': '栏目标题',
  'Empty = plain text, no link.': '留空则显示为纯文字，不带链接。',
  'Muted suffix': '灰色后缀',
  'e.g. <code>（海外）</code> or <code>— distribution</code>':
    '例如 <code>（海外）</code> 或 <code>— distribution</code>',
  'Contact columns': '联系方式分栏',
  'Footer': '页脚',
  'Copyright line': '版权文字',
  'Follows the © and the year. Inline HTML allowed.': '跟在 © 和年份之后。可使用行内 HTML。',
  'Back-to-top label': '回到顶部文字',

  // ----------------------------------------------------------- nav & chrome
  'Navigation': '导航',
  'Skip-to-content link': '跳至正文链接',
  'Link target': '链接目标',
  'Contact button': '联系按钮',
  'Bilibili notice': 'B 站提示框',
  '中文 only': '仅中文页',
  'Pending-video flags': '待上线视频标记',
  'Shown on tiles whose Bilibili BV id is still empty.': '显示在 BV 号尚未填写的视频上。',
  'Feature tile': '主打视频',
  'Grid tiles': '网格视频',
  'Body': '正文',
  'Inline links allowed.': '可使用行内链接。',

  // ----------------------------------------------------------- photos
  'Grid order': '网格顺序',
  '{n} pieces — open to reorder': '共 {n} 项 — 展开可调整顺序',
  'Photo categories': '照片分类',
  'Category: {key}': '分类：{key}',
  '"Open" label (screen readers)': '「查看」标签（屏幕阅读器）',
  '"Close" label (screen readers)': '「关闭」标签（屏幕阅读器）',
  'Opens into a larger view': '点击可展开查看',
  'This picture does not open, so nothing here is shown. Tick the box above to use it.':
    '这张图片不可展开，因此这里的文字不会显示。勾选上面的选项即可启用。',
  'Shape': '形状',
  'Size': '大小',
  'Category': '分类',
  'Caption': '说明',
  'Set automatically when you upload.': '上传时会自动判断。',
  '(no caption)': '（无说明）',
  'opens': '可展开',
  'Square': '正方形',
  'Portrait (4:5)': '竖版（4:5）',
  'Tall (2:3)': '长竖版（2:3）',
  'Landscape (3:2)': '横版（3:2）',
  'Wide (2:1)': '宽幅（2:1）',
  'Panorama (3:1)': '全景（3:1）',
  'Small': '小',
  'Medium': '中',
  'Large': '大',

  // ----------------------------------------------------------- recording
  'Now Recording': '正在录制',
  'Heading': '标题',
  'Text': '正文',
  'Centre': '中心作品',
  'Centre description (alt text)': '中心图描述（替代文字）',
  'The still picture in the middle of the ring, shown square.': '环形中央的静止图片，按正方形显示。',
  'Any shape works: the ring keeps each picture’s own proportions.':
    '任何比例都可以：环形会保留每张图片自身的比例。',
  'The heading of the card it opens into. Not shown on the ring itself.':
    '展开后卡片的标题。不会显示在环形上。',
  'Scroll orbit': '滚动环形图',
  'The ring, in the order it goes round. These are decorative and carry no alt text.':
    '环形图片，按转动顺序排列。它们是装饰性的，不带替代文字。',

  // ----------------------------------------------------------- hero
  'Hero': '首屏',
  'Hidden heading (screen readers)': '隐藏标题（屏幕阅读器）',
  'Subheading': '副标题',

  // ----------------------------------------------------------- image cards

  // ----------------------------------------------------------- long notes
  'Uploads commit to the draft branch straight away, so a new picture is on the preview URL immediately — but it will 404 in this admin until you publish, because this page loads previews from the live site.':
    '上传会立即提交到草稿分支，所以新图片马上就能在预览地址上看到 — 但在发布之前，它在后台里会显示 404，因为本页的预览图是从线上站点加载的。',
  'Optional. Write something and the picture opens into a card with this text when it is clicked; leave it empty and it stays a still picture. A blank line starts a new paragraph.':
    '可不填。填写后，点击图片会展开成带这段文字的卡片；留空则保持为静止图片。空一行即另起一段。',
  'Direct access to the three content files, for anything the forms above do not cover. Invalid JSON will refuse to save.':
    '直接编辑三个内容文件，用于上面表单未覆盖的内容。JSON 格式有误时将无法保存。',
  'Top to bottom here is left-to-right, row by row on the page. The grid fills gaps with later, smaller pieces, so a big piece followed by several small ones packs best.':
    '这里由上到下，对应页面上逐行从左到右的顺序。网格会用后面较小的作品填补空隙，所以一张大图后面跟几张小图排得最紧凑。',
  'The box above the video grid on the Chinese page. Delete it once every video has a BV id.':
    '中文页视频网格上方的提示框。所有视频都填好 BV 号后即可删除。',
  'The block at the top of In the Making: a heading, a line of text, and a second ring that turns as the page scrolls. It sits above the original ring, which is edited further down.':
    '「创作手记」页顶部的区块：一个标题、一段文字，以及随页面滚动转动的第二个环形图。它位于原有环形图之上，原有环形图在下方编辑。',
  'The still cover in the middle of the ring. Its artwork and alt text come from that release, so the ring circles something the rest of the site already shows.':
    '环形中央的静止封面。图片与替代文字取自该作品，所以环形围绕的正是站点其他地方已经展示过的内容。',
  'The window the "Message Tony" button opens. Sending is not connected online yet, so on the deployed site it shows the error line; the local preview accepts messages. <code>{to}</code> and <code>{email}</code> are filled in for you — leave them in.':
    '「给 Tony 留言」按钮打开的窗口。线上发送功能尚未接通，因此已部署的站点会显示失败提示；本地预览可以正常接收留言。<code>{to}</code> 与 <code>{email}</code> 会自动填入 — 请保留它们。',

  // ----------------------------------------------------------- tab intros
  'One grid under the title video holds the photos and the videos together. Its order is set in <b>Grid order</b> below; the grid packs the pieces, so mixing shapes and sizes is what makes it look designed. The gradient pictures are placeholders — use <b>Replace</b> as the real photos arrive.':
    '主打视频下方的同一个网格里同时放着照片和视频。顺序在下面的<b>网格顺序</b>里设置；网格会自动拼排，所以混用不同形状和大小才会显得是设计过的。渐变色的图片是占位图 — 真实照片到位后用<b>替换</b>换掉即可。',
  'Press &amp; Mentions, which closes the About page. The English page shows an English title with a gloss underneath; those are descriptions for readers, not official headlines, so keep them descriptive rather than authoritative.':
    '媒体报道，位于页面末尾。英文页显示英文标题并在下方附一行释义；那些是写给读者看的描述，而非官方标题，所以措辞应保持描述性，不要显得像正式定论。',
  'The In the Making page. It carries its heading and the scroll orbit; the notes that belong underneath have not been written yet. Press coverage moved to the foot of the About page.':
    '创作手记页。目前包含标题和滚动环形图；下方应有的手记文字尚未撰写。媒体报道已移至关于页的底部。',
  'The contact block and the footer, which finish every page. The email here is the public-facing management address — it appears in both languages and in the mailto link.':
    '收尾每个页面的联系版块与页脚。这里的邮箱是对外公开的经纪联系地址 — 它会出现在两种语言的页面和 mailto 链接里。',
};

/* The admin's own language, kept in this browser rather than in the content:
 * it is a preference of whoever is sitting here, not a property of the site,
 * and the two editors may well not want the same one. */
const UI_LANG_KEY = 'tonyd-admin-ui-lang';

function readUiLang() {
  try {
    const saved = localStorage.getItem(UI_LANG_KEY);
    if (saved === 'en' || saved === 'zh') return saved;
  } catch { /* private window, blocked storage */ }
  // Someone arriving with a Chinese browser almost certainly wants Chinese
  return (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function saveUiLang(lang) {
  try { localStorage.setItem(UI_LANG_KEY, lang); } catch { /* not fatal */ }
}

/** Translate one interface string, filling {placeholders} from `vars`. */
function T(text, vars) {
  let out = (UI.lang === 'zh' && UI_STRINGS[text]) || text;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, v);
  }
  return out;
}

const UI = { lang: readUiLang() };

/** Keys that no longer match any English string in admin.js — run after edits.
 *
 * Long strings are written as several adjacent literals in admin.js, so the
 * source is de-concatenated first: without that, every wrapped string looks
 * orphaned and the report is all false positives. */
function missing() {
  return Promise.all(['admin.js', 'preview.js'].map((f) => fetch(f).then((r) => r.text())))
    .then((parts) => parts.join('\n'))
    .then((src) => {
      const joined = src.replace(/'\s*\+\s*'/g, '');
      return Object.keys(UI_STRINGS).filter((k) => !joined.includes(k));
    });
}
