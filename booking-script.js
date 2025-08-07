// 로컬 환경변수 파일 로드
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

class PilatesBooking {
    constructor() {
        this.username = process.env.PILATES_USERNAME; // 회원이름
        this.password = process.env.PILATES_PASSWORD; // 회원번호
        this.baseUrl = 'https://ad2.mbgym.kr';
        this.maxRetries = 3;
        this.retryDelay = 2000;
        
        // 테스트 모드 설정
        this.testMode = process.env.TEST_MODE === 'true';
        this.skipWait = process.env.SKIP_WAIT === 'true';
    }

    async init() {
        try {
            await fs.mkdir('screenshots', { recursive: true });
            await fs.mkdir('logs', { recursive: true });
        } catch (err) {
            console.log('디렉토리 생성 중 오류 (무시 가능):', err.message);
        }
        
        const timestamp = new Date().toISOString();
        await this.log(`=== 예약 시작: ${timestamp} ===`);
        
        if (this.testMode) {
            await this.log('⚠️ 테스트 모드로 실행 중 (실제 예약하지 않음)');
        }
    }

    async log(message) {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ${message}\n`;
        console.log(message);
        
        const logFile = this.testMode ? 'logs/test.log' : 'logs/booking.log';
        await fs.appendFile(logFile, logMessage).catch(() => {});
    }

    async takeScreenshot(page, name) {
        try {
            await fs.mkdir('screenshots', { recursive: true });
            
            const timestamp = Date.now();
            const prefix = this.testMode ? 'test-' : '';
            const filename = `screenshots/${prefix}${name}-${timestamp}.png`;
            await page.screenshot({ path: filename, fullPage: true });
            await this.log(`📸 스크린샷 저장: ${filename}`);
            return filename;
        } catch (error) {
            await this.log(`⚠️ 스크린샷 실패: ${error.message}`);
        }
    }

    async login(page) {
        await this.log('🔐 로그인 시도...');
        
        try {
            // 인코딩 설정
            await page.setExtraHTTPHeaders({
                'Accept-Language': 'ko-KR,ko;q=0.9',
                'Accept-Charset': 'UTF-8'
            });
            
            // 로그인 페이지로 이동 (기존 URL 유지)
            await page.goto(`${this.baseUrl}/yeapp/yeapp.php?tm=102`, {
                waitUntil: 'networkidle2',
                timeout: 30000
            });
            
            await this.takeScreenshot(page, '01-login-page');
            
            // 이미 로그인된 상태인지 확인
            const logoutLink = await page.$('a[href*="yeout.php"]');
            if (logoutLink) {
                await this.log('✅ 이미 로그인된 상태');
                return true;
            }
            
            // 로그인 폼 입력 - 기존 방식 유지
            await page.waitForSelector('input[name="name"]', { timeout: 10000 });
            
            // 입력 필드 클리어 후 입력
            const useridInput = await page.$('input[name="name"]');
            await useridInput.click({ clickCount: 3 });
            await page.type('input[name="name"]', this.username, { delay: 100 });
            
            const userpwInput = await page.$('input[name="passwd"]');
            await userpwInput.click({ clickCount: 3 });
            await page.type('input[name="passwd"]', this.password, { delay: 100 });
            
            await this.log(`📝 입력 정보: 이름=${this.username}, 번호=${this.password}`);
            
            // 로그인 버튼 클릭
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle2' }),
                page.click('input[type="submit"]')
            ]);
            
            await this.takeScreenshot(page, '02-after-login');
            
            // 로그인 성공 확인
            const currentUrl = page.url();
            if (currentUrl.includes('res_postform.php')) {
                await this.log('✅ 로그인 성공 - 예약 페이지 진입');
                return true;
            }
            
            await this.log('✅ 로그인 완료');
            return true;
            
        } catch (error) {
            await this.log(`❌ 로그인 실패: ${error.message}`);
            throw error;
        }
    }

    async navigateToBookingPage(page) {
        await this.log('📅 예약 페이지로 이동...');
        
        // 7일 후 날짜 계산
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + 7);
        const day = targetDate.getDate();
        const year = targetDate.getFullYear();
        const month = targetDate.getMonth() + 1;
        
        await this.log(`📆 예약 날짜: ${year}년 ${month}월 ${day}일`);
        
        // 현재 페이지가 이미 예약 페이지인지 확인
        const currentUrl = page.url();
        if (currentUrl.includes('res_postform.php')) {
            await this.log('📍 이미 예약 페이지에 있음');
            
            // 해당 날짜 클릭
            const dateClicked = await page.evaluate((targetDay) => {
                const cells = document.querySelectorAll('td');
                
                for (let cell of cells) {
                    const text = cell.textContent.trim();
                    
                    // 정확한 날짜 매칭
                    if (text === String(targetDay) || 
                        (text.startsWith(String(targetDay)) && !text.includes('X'))) {
                        
                        // 클릭 가능한 요소 찾기
                        const link = cell.querySelector('a');
                        if (link) {
                            // onclick 속성 확인
                            const onclickAttr = link.getAttribute('onclick');
                            if (onclickAttr) {
                                console.log('onclick 발견:', onclickAttr);
                                // JavaScript 함수 직접 실행
                                try {
                                    eval(onclickAttr);
                                } catch(e) {
                                    link.click();
                                }
                            } else {
                                link.click();
                            }
                            return true;
                        } else if (!text.includes('X')) {
                            cell.click();
                            return true;
                        }
                    }
                }
                return false;
            }, day);
            
            if (dateClicked) {
                await this.log(`✅ ${day}일 클릭 완료`);
                // 페이지 로드 대기
                await page.waitForTimeout(3000);
                
                // 페이지 이동 확인
                const newUrl = page.url();
                if (newUrl !== currentUrl) {
                    await this.log(`📍 새 페이지로 이동: ${newUrl}`);
                }
            } else {
                await this.log(`⚠️ ${day}일 예약 불가 또는 마감`);
            }
        }
        
        await this.takeScreenshot(page, '03-booking-page');
        return { year, month, day };
    }

async find1030ClassAndBook(page) {
    await this.log('🔍 10:30 수업 찾는 중...');
    
    try {
        await page.waitForSelector('table', { timeout: 5000 });
        await this.takeScreenshot(page, '04-time-table');
        
        // 10:30 수업 찾기 및 예약
        const result = await page.evaluate(() => {
            const rows = document.querySelectorAll('tr');
            
            for (let row of rows) {
                const cells = row.querySelectorAll('td');
                
                // 시간 찾기
                for (let i = 0; i < cells.length; i++) {
                    const cellText = cells[i].textContent.trim();
                    
                    if (cellText === '오전 10:30' || cellText.includes('10:30')) {
                        console.log('✅ 10:30 수업 발견!');
                        
                        // 수강 정원 확인 (예: "바렐 체어(승정쌤)(4/8)")
                        let courseInfo = '';
                        let isFull = false;
                        
                        for (let j = 0; j < cells.length; j++) {
                            const text = cells[j].textContent;
                            if (text.includes('/8')) {
                                courseInfo = text;
                                // 정원 확인 (8/8이면 만석)
                                if (text.includes('(8/8)')) {
                                    isFull = true;
                                    console.log('⚠️ 정원 초과 상태');
                                }
                                break;
                            }
                        }
                        
                        // 버튼 찾기
                        const buttons = row.querySelectorAll('button, input[type="button"], a');
                        
                        for (let btn of buttons) {
                            const btnText = (btn.textContent || btn.value || '').trim();
                            
                            // 케이스 1: 예약하기 버튼 (정원 여유)
                            if (btnText === '예약하기') {
                                console.log('예약하기 버튼 클릭!');
                                btn.click();
                                return {
                                    found: true,
                                    booked: true,
                                    message: '10:30 수업 예약하기 클릭',
                                    type: 'normal',
                                    courseInfo: courseInfo
                                };
                            }
                            
                            // 케이스 2: 삭제 버튼 (이미 예약됨)
                            else if (btnText === '삭제') {
                                return {
                                    found: true,
                                    booked: false,
                                    message: '10:30 수업 이미 예약되어 있음',
                                    type: 'already'
                                };
                            }
                        }
                        
                        // 케이스 3: 버튼이 없고 정원 초과 → 대기예약 시도
                        if (isFull && buttons.length === 0) {
                            console.log('정원 초과 - 대기예약 시도');
                            
                            // 대기예약을 위해 행 클릭 또는 체크박스 찾기
                            const checkbox = row.querySelector('input[type="checkbox"]');
                            if (checkbox) {
                                checkbox.checked = true;
                                checkbox.click();
                                console.log('체크박스 선택 (대기예약용)');
                                
                                return {
                                    found: true,
                                    booked: true,
                                    message: '10:30 수업 대기예약 시도',
                                    type: 'waiting',
                                    needWaitingProcess: true,
                                    courseInfo: courseInfo
                                };
                            }
                            
                            // 또는 행 자체 클릭
                            row.click();
                            return {
                                found: true,
                                booked: true,
                                message: '10:30 수업 대기예약 시도 (행 클릭)',
                                type: 'waiting',
                                needWaitingProcess: true,
                                courseInfo: courseInfo
                            };
                        }
                        
                        // 케이스 4: 예약 불가
                        return {
                            found: true,
                            booked: false,
                            message: '10:30 수업 예약 불가 상태',
                            courseInfo: courseInfo
                        };
                    }
                }
            }
            
            return {
                found: false,
                booked: false,
                message: '10:30 수업을 찾을 수 없음'
            };
        });
        
        await this.log(`🔍 검색 결과: ${result.message}`);
        if (result.courseInfo) {
            await this.log(`📚 수업 정보: ${result.courseInfo}`);
        }
        
        // 대기예약 추가 처리
        if (result.needWaitingProcess && !this.testMode) {
            await this.log('⏳ 대기예약 프로세스 진행...');
            await page.waitForTimeout(1000);
            
            // 대기예약 버튼 찾기
            const waitingBooked = await page.evaluate(() => {
                // 페이지 하단의 대기예약 버튼 찾기
                const buttons = document.querySelectorAll('button, input[type="button"], input[type="submit"]');
                
                for (let btn of buttons) {
                    const text = (btn.textContent || btn.value || '').trim();
                    if (text.includes('대기예약') || text.includes('대기')) {
                        console.log('대기예약 버튼 클릭!');
                        btn.click();
                        return true;
                    }
                }
                
                // 또는 목록보기 버튼
                for (let btn of buttons) {
                    const text = (btn.textContent || btn.value || '').trim();
                    if (text === '목록보기') {
                        console.log('목록보기 버튼 클릭!');
                        btn.click();
                        return true;
                    }
                }
                
                return false;
            });
            
            if (waitingBooked) {
                await this.log('✅ 대기예약 버튼 클릭 완료');
                // confirm 팝업은 dialog 핸들러에서 자동 처리
                await page.waitForTimeout(2000);
            }
        }
        
        // 예약 완료 확인
        if (result.booked) {
            await page.waitForTimeout(2000);
            
            const confirmed = await page.evaluate(() => {
                const bodyText = document.body.innerText;
                return {
                    normal: bodyText.includes('예약완료') || bodyText.includes('예약이 완료'),
                    waiting: bodyText.includes('대기예약') || bodyText.includes('대기 예약')
                };
            });
            
            if (confirmed.normal) {
                await this.log('✅ 일반 예약 완료!');
            } else if (confirmed.waiting) {
                await this.log('⚠️ 대기예약 완료!');
                result.type = 'waiting';
            }
            
            await this.takeScreenshot(page, '05-after-booking');
        }
        
        return result;
        
    } catch (error) {
        await this.log(`❌ 예약 과정 에러: ${error.message}`);
        await this.takeScreenshot(page, 'error-booking');
        throw error;
    }
}
    
    async verifyBooking(page) {
        await this.log('🔍 예약 확인 중...');
        
        try {
            // 예약 확인 페이지로 이동
            await page.goto(`${this.baseUrl}/yeapp/yeapp.php?tm=103`, {
                waitUntil: 'networkidle2'
            });
            
            await page.waitForTimeout(2000);
            
            const bookingVerified = await page.evaluate(() => {
                const bodyText = document.body.innerText;
                
                // 7일 후 날짜 계산
                const targetDate = new Date();
                targetDate.setDate(targetDate.getDate() + 7);
                const month = targetDate.getMonth() + 1;
                const day = targetDate.getDate();
                
                // 예약 내역에서 확인
                if (bodyText.includes('10:30') && 
                    (bodyText.includes(`${month}월`) && bodyText.includes(`${day}일`))) {
                    return true;
                }
                
                return false;
            });
            
            if (bookingVerified) {
                await this.log('✅ 예약이 정상적으로 확인되었습니다!');
                await this.takeScreenshot(page, '08-booking-verified');
                return true;
            } else {
                await this.log('⚠️ 예약 내역에서 확인되지 않음');
                await this.takeScreenshot(page, '08-booking-not-found');
                return false;
            }
            
        } catch (error) {
            await this.log(`⚠️ 예약 확인 실패: ${error.message}`);
            return false;
        }
    }

    async run() {
        await this.init();
        
        // 12시 대기 (필요한 경우)
        if (!this.skipWait && !this.testMode) {
            const waitScript = require('./wait-until-noon');
            await waitScript.waitUntilNoon();
        }
        
        let retryCount = 0;
        let success = false;
        
        while (retryCount < this.maxRetries && !success) {
            const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
            const isCI = process.env.CI === 'true';
            
            const browser = await puppeteer.launch({
                headless: process.env.HEADLESS !== 'false' ? 'new' : false,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-web-security',
                    '--disable-features=IsolateOrigins,site-per-process',
                    '--window-size=1920,1080',
                    '--lang=ko-KR',
                    ...(isGitHubActions || isCI ? ['--single-process', '--no-zygote'] : [])
                ]
            });
            
            try {
                const page = await browser.newPage();
                
                // 페이지 인코딩 설정
                await page.evaluateOnNewDocument(() => {
                    document.charset = "UTF-8";
                });
                
                // 설정
                page.setDefaultTimeout(30000);
                await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
                await page.setViewport({ width: 1920, height: 1080 });
                
                // 콘솔 로그 캡처
                page.on('console', msg => {
                    if (msg.type() === 'log') {
                        this.log(`[브라우저]: ${msg.text()}`);
                    }
                });
                
                // 알림 처리
                page.on('dialog', async dialog => {
                    const message = dialog.message();
                    await this.log(`📢 알림: ${message}`);
                    
                    // 예약 성공 메시지 확인
                    if (message.includes('예약') && 
                        (message.includes('완료') || message.includes('성공'))) {
                        success = true;
                        await this.log('🎉 예약 성공 알림 확인!');
                    }
                    
                    // 대기예약 확인
                    if (message.includes('대기예약') || message.includes('정원이 초과')) {
                        await this.log('⚠️ 대기예약 확인 팝업');
                    }
                    
                    // 로그인 실패 메시지 확인
                    if (message.includes('등록되어 있지 않습니다')) {
                        await dialog.accept();
                        throw new Error('로그인 정보 오류');
                    }
                    
                    await dialog.accept();
                });
                
                // 1. 로그인
                await this.login(page);
                
                // 2. 예약 페이지로 이동
                const dateInfo = await this.navigateToBookingPage(page);
                
                // 3. 10:30 수업 찾고 예약
                const result = await this.find1030ClassAndBook(page);
                
                // 4. 예약 확인 (테스트 모드가 아닌 경우)
                if (!this.testMode && result.booked) {
                    const verified = await this.verifyBooking(page);
                    if (verified) {
                        success = true;
                    }
                } else if (this.testMode && result.found) {
                    success = true;
                }
                
                if (success) {
                    await this.log('🎉🎉🎉 프로세스 완료! 🎉🎉🎉');
                    
                    // 결과 저장
                    const resultInfo = {
                        timestamp: new Date().toISOString(),
                        date: `${dateInfo.year}-${dateInfo.month}-${dateInfo.day}`,
                        class: '10:30',
                        status: this.testMode ? 'TEST' : (result.isWaitingOnly ? 'WAITING' : 'SUCCESS'),
                        message: result.message,
                        verified: !this.testMode ? success : null
                    };
                    
                    const resultFile = this.testMode ? 'test-result.json' : 'booking-result.json';
                    await fs.writeFile(
                        resultFile,
                        JSON.stringify(resultInfo, null, 2)
                    );
                    
                    if (result.isWaitingOnly) {
                        await this.log('⚠️ 대기예약으로 등록되었습니다. 취소가 발생하면 자동으로 예약됩니다.');
                    }
                } else if (result.found) {
                    await this.log('⚠️ 10:30 수업은 있지만 예약 불가');
                    break;
                } else {
                    throw new Error('10:30 수업을 찾을 수 없음');
                }
                
            } catch (error) {
                retryCount++;
                await this.log(`❌ 시도 ${retryCount}/${this.maxRetries} 실패: ${error.message}`);
                
                if (retryCount < this.maxRetries) {
                    await this.log(`⏳ ${this.retryDelay/1000}초 후 재시도...`);
                    await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                }
            } finally {
                await browser.close();
            }
        }
        
        if (!success) {
            await this.log('❌❌❌ 예약 실패 ❌❌❌');
            
            // 실패 시에도 결과 파일 생성
            const resultFile = this.testMode ? 'test-result.json' : 'booking-result.json';
            await fs.writeFile(
                resultFile,
                JSON.stringify({
                    timestamp: new Date().toISOString(),
                    status: 'FAILED',
                    message: '예약 실패'
                }, null, 2)
            );
            
            process.exit(1);
        }
    }
}

// 환경변수 확인
if (!process.env.PILATES_USERNAME || !process.env.PILATES_PASSWORD) {
    console.error('❌ 환경변수가 필요합니다:');
    console.error('   PILATES_USERNAME: 회원이름');
    console.error('   PILATES_PASSWORD: 회원번호');
    console.error('');
    console.error('💡 설정 방법:');
    console.error('   1. .env 파일 생성 (로컬)');
    console.error('   2. GitHub Secrets 설정 (GitHub Actions)');
    process.exit(1);
}

// 실행
const booking = new PilatesBooking();
booking.run().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
