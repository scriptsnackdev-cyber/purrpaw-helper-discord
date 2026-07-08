const fs = require('fs');
const path = require('path');

// Configuration - adjust paths if needed
const fileA = path.join(__dirname, 'TICKET_LOG', 'db', 'leveling.json');
const fileB = path.join(__dirname, 'TICKET_LOG', 'db', 'leveling.json.bak');
const outputFile = path.join(__dirname, 'TICKET_LOG', 'db', 'leveling.json.merged');

function mergeDbs() {
  if (!fs.existsSync(fileA)) {
    console.error(`❌ Error: Primary file not found at: ${fileA}`);
    return;
  }
  if (!fs.existsSync(fileB)) {
    console.error(`❌ Error: Backup file to merge not found at: ${fileB}`);
    return;
  }

  try {
    const dbA = JSON.parse(fs.readFileSync(fileA, 'utf8'));
    const dbB = JSON.parse(fs.readFileSync(fileB, 'utf8'));

    const merged = {
      guilds: { ...dbA.guilds },
      users: { ...dbA.users }
    };

    console.log('🔄 Merging Guild configurations...');
    if (dbB.guilds) {
      for (const guildId of Object.keys(dbB.guilds)) {
        if (!merged.guilds[guildId]) {
          merged.guilds[guildId] = dbB.guilds[guildId];
        } else {
          // Merge leveling enabled state (true if either is true)
          merged.guilds[guildId].leveling_enabled =
            merged.guilds[guildId].leveling_enabled || dbB.guilds[guildId].leveling_enabled;

          // Merge and deduplicate rewards by level
          const rewardsA = merged.guilds[guildId].rewards || [];
          const rewardsB = dbB.guilds[guildId].rewards || [];
          const rewardsMap = new Map();
          rewardsA.forEach(r => rewardsMap.set(r.level, r.role_id));
          rewardsB.forEach(r => rewardsMap.set(r.level, r.role_id));

          merged.guilds[guildId].rewards = Array.from(rewardsMap.entries())
            .map(([level, role_id]) => ({ level, role_id }))
            .sort((a, b) => b.level - a.level);
        }
      }
    }

    console.log('🔄 Merging User total_chars (XP)...');
    let userMergeCount = 0;
    let newUsersCount = 0;

    if (dbB.users) {
      for (const guildId of Object.keys(dbB.users)) {
        if (!merged.users[guildId]) {
          merged.users[guildId] = { ...dbB.users[guildId] };
          newUsersCount += Object.keys(dbB.users[guildId]).length;
        } else {
          for (const userId of Object.keys(dbB.users[guildId])) {
            if (!merged.users[guildId][userId]) {
              merged.users[guildId][userId] = { ...dbB.users[guildId][userId] };
              newUsersCount++;
            } else {
              const charsA = merged.users[guildId][userId].total_chars || 0;
              const charsB = dbB.users[guildId][userId].total_chars || 0;
              
              // Sum total_chars from both databases
              merged.users[guildId][userId].total_chars = charsA + charsB;
              userMergeCount++;
            }
          }
        }
      }
    }

    // Backup current leveling.json to leveling.json.bak2
    const backupFile = path.join(__dirname, 'TICKET_LOG', 'db', 'leveling.json.bak2');
    fs.renameSync(fileA, backupFile);
    console.log(`📦 Backed up current active file to: ${backupFile}`);

    // Write output directly to leveling.json
    fs.writeFileSync(fileA, JSON.stringify(merged, null, 2), 'utf8');

    console.log('\n✅ Merge Completed and Applied Successfully!');
    console.log(`- Stitched users with combined XP: ${userMergeCount}`);
    console.log(`- New users added: ${newUsersCount}`);
    console.log(`- Saved merged output directly to: ${fileA}`);
  } catch (error) {
    console.error('❌ An error occurred during merging:', error);
  }
}

mergeDbs();
