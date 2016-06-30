
lotus = require process.env.LOTUS_PATH + "/lotus"

git = require "git-utils"

modulePath = lotus.path + "/node-haste"
promise = git.mergeFiles modulePath,

  verbose: yes

  ours: modulePath + "/src/"

  theirs: lotus.path + "/react-packager/src/DependencyResolver/"

  rename: {
    "lib": "utils"
    "DependencyGraph/docblock.js": "utils/docblock.js"
    "DependencyGraph/ResolutionRequest.js": "ResolutionRequest.js"
    "DependencyGraph/ResolutionResponse.js": "ResolutionResponse.js"
    "DependencyGraph/HasteMap.js": "HasteMap.js"
  }

  unlink: [
    "DependencyGraph"
  ]

  merge: {
    "docblock.js": "utils/docblock.js"
    "DependencyGraph.js": "index.js"
    "AssetModule.js"
    "Cache/index.js"
    "crawlers"
    "fastfs.js"
    "File.js"
    "FileWatcher"
    "HasteMap.js"
    "Module.js"
    "ModuleCache.js"
    "NullModule.js"
    "Package.js"
    "Polyfill.js"
    "ResolutionRequest.js"
    "ResolutionResponse.js"
  }
