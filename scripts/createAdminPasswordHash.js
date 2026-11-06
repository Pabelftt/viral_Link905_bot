const bcrypt = require('bcryptjs');

function readPassword() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Run this command in an interactive terminal so the password is not echoed.');
  }
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    stdout.write('Admin password (input hidden): ');
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let password = '';
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
    };
    const onData = (key) => {
      if (key === '\u0003') {
        cleanup();
        stdout.write('\n');
        reject(new Error('Password hash generation cancelled.'));
      } else if (key === '\r' || key === '\n') {
        cleanup();
        stdout.write('\n');
        resolve(password);
      } else if (key === '\u007f' || key === '\b') {
        password = password.slice(0, -1);
      } else if (key >= ' ') {
        password += key;
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const password = await readPassword();
  if (password.length < 12 || password.length > 200) {
    throw new Error('Use an admin password between 12 and 200 characters.');
  }
  const hash = await bcrypt.hash(password, 12);
  console.info('\nSet this value as ADMIN_PASSWORD_HASH in your private .env file:\n');
  console.info(hash);
  console.info('\nDo not commit the hash or share it publicly.');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
