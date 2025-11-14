const http = require('http');

function testAPI(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: 'GET'
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        console.log(`\n📡 Testing: ${path}`);
        console.log(`   Status: ${res.statusCode}`);
        
        if (res.statusCode === 200) {
          try {
            const json = JSON.parse(data);
            console.log(`   ✓ Success`);
            console.log(`   Response:`, JSON.stringify(json, null, 2).substring(0, 200));
          } catch (e) {
            console.log(`   ⚠️  Invalid JSON response`);
          }
        } else {
          console.log(`   ✗ Failed: ${res.statusCode}`);
          console.log(`   Response:`, data.substring(0, 200));
        }
        
        resolve();
      });
    });

    req.on('error', (error) => {
      console.log(`\n📡 Testing: ${path}`);
      console.log(`   ✗ Error: ${error.message}`);
      resolve();
    });

    req.end();
  });
}

async function runTests() {
  console.log('🧪 Testing Socket.IO Server API Endpoints\n');
  console.log('Make sure the server is running on port 3000!\n');
  
  await testAPI('/health');
  await testAPI('/api/sensor/1/history?hours=1');
  await testAPI('/api/sensor/1/analytics?hours=24');
  await testAPI('/api/sensor/0/history?hours=1');
  await testAPI('/api/sensor/invalid/history?hours=1');
  
  console.log('\n✅ Tests complete!\n');
  console.log('Expected results:');
  console.log('  - /health should return 200');
  console.log('  - /api/sensor/1/history should return 200 (may have 0 readings if no data yet)');
  console.log('  - /api/sensor/1/analytics should return 200');
  console.log('  - Invalid sensor ID should return 400\n');
}

runTests();