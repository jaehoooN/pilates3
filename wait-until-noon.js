const waitUntilNoon = async () => {
  console.log('⏰ 12시 대기 스크립트 시작');
  
  const getKSTTime = () => {
    const now = new Date();
    const kstOffset = 9 * 60;
    const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
    return new Date(utcTime + (kstOffset * 60000));
  };
  
  const kstNow = getKSTTime();
  console.log(`현재 한국 시간: ${kstNow.toLocaleString('ko-KR')}`);
  
  const target = new Date(kstNow);
  target.setHours(12, 0, 0, 0);
  
  if (kstNow >= target) {
    console.log('✅ 이미 12시가 지났습니다.');
    return;
  }
  
  const waitMs = target - kstNow;
  const waitMinutes = Math.floor(waitMs / 60000);
  const waitSeconds = Math.floor((waitMs % 60000) / 1000);
  
  console.log(`⏳ 대기 시간: ${waitMinutes}분 ${waitSeconds}초`);
  console.log(`⏰ 예약 시작 예정: ${target.toLocaleString('ko-KR')}`);
  
  // 대기
  await new Promise(resolve => {
    const interval = setInterval(() => {
      const now = getKSTTime();
      const remaining = target - now;
      
      if (remaining <= 0) {
        clearInterval(interval);
        console.log('✅ 12시 00분 00초 도달!');
        resolve();
      } else if (remaining < 10000) {
        const seconds = Math.ceil(remaining / 1000);
        console.log(`🔥 ${seconds}...`);
      }
    }, 100);
  });
};

module.exports = { waitUntilNoon };

// 직접 실행 시
if (require.main === module) {
  waitUntilNoon().then(() => {
    console.log('✅ 대기 완료');
  }).catch(error => {
    console.error('❌ 오류:', error);
  });
}
