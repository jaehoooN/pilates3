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
        
        // 핵심 셀렉터 정의 (세션 1 분석 기반)
        this.selectors = {
            login_id: 'input#user_id',
            login_pw: 'input#passwd',
            login_btn: 'button[type="submit"]',
            time_10_30: 'td:has-text("오전 10:30"), td:has-text("10:30")',
            reservation_btn: 'a:has-text("예약하기")',
            waiting_btn: 'a:has-text("대기예약")',
            submit_btn: 'button:has-text("Submit"), input[type="submit"], button:has-text("예약")'
        };
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
            // 메인 페이지로 이동
            await page.goto(this.baseUrl, {
                waitUntil: 'networkidle2',
                timeout: 30000
            });
            
            await this.takeScreenshot(page, '01-main-page');
            
            // 로그인 폼 대기
            await page.waitForSelector(this.selectors.login_id, { timeout: 10000 });
            
            // 아이디 입력 (개선: 클리어 후 입력)
            const idInput = await page.$(this.selectors.login_id);
            await idInput.click({ clickCount: 3 });
            await page.type(this.selectors.login_id, this.username, { delay: 100 });
            
            // 비밀번호 입력
            const pwInput = await page.$(this.selectors.login_pw);
            await pwInput.click({ clickCount: 3 });
            await page.type(this.selectors.login_pw, this.password, { delay: 100 });
            
            await this.log(`📝 입력 정보: 이름=${this.username}, 번호=${this.password}`);
            await this.takeScreenshot(page, '02-login-form');
            
            // 로그인 버튼 클릭
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle2' }),
                page.click(this.selectors.login_btn)
            ]);
            
            await this.takeScreenshot(page, '03-after-login');
            
            await this.log('✅ 로그인 성공');
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
        
        try {
            // 예약 페이지로 이동
            await page.goto(`${this.baseUrl}/yeapp/yeapp.php?tm=102`, {
                waitUntil: 'networkidle2'
            });
            
            await page.waitForTimeout(2000);
            await this.takeScreenshot(page, '04-calendar-page');
            
            // 날짜가 예약 가능한지 확인 (X 표시 확인)
            const isDateAvailable = await page.evaluate((targetDay) => {
                const cells = document.querySelectorAll('td');
                for (let cell of cells) {
                    const text = cell.textContent.trim();
                    // 정확한 날짜 매칭
                    if (text === String(targetDay) || 
                        (text.startsWith(String(targetDay)) && !text.includes('X'))) {
                        // 링크가 있으면 클릭 가능
                        const link = cell.querySelector('a');
                        return !!link;
                    }
                }
                return false;
            }, day);
            
            if (!isDateAvailable) {
                await this.log(`⚠️ ${day}일은 예약이 불가능합니다 (마감 또는 X 표시)`);
                throw new Error('예약 불가능한 날짜');
            }
            
            // 날짜 클릭
            const dateClicked = await page.evaluate((targetDay) => {
                const cells = document.querySelectorAll('td');
                for (let cell of cells) {
                    const text = cell.textContent.trim();
                    if (text === String(targetDay) || 
                        (text.startsWith(String(targetDay)) && !text.includes('X'))) {
                        const link = cell.querySelector('a');
                        if (link) {
                            link.click();
                            return true;
                        }
                    }
                }
                return false;
            }, day);
            
            if (dateClicked) {
                await this.log(`✅ ${day}일 클릭 완료`);
                await page.waitForTimeout(3000); // 시간표 로딩 대기
                await this.takeScreenshot(page, '05-timetable');
            } else {
                throw new Error('날짜 클릭 실패');
            }
            
        } catch (error) {
            await this.log(`❌ 예약 페이지 이동 실패: ${error.message}`);
            throw error;
        }
        
        return { year, month, day };
    }

    async find1030ClassAndBook(page) {
        await this.log('🔍 10:30 수업 찾는 중...');
        
        try {
            await page.waitForSelector('table', { timeout: 5000 });
            
            // 10:30 수업 찾기 및 예약 상태 확인
            const result = await page.evaluate(() => {
                const rows = document.querySelectorAll('tr');
                
                for (let row of rows) {
                    const cells = row.querySelectorAll('td');
                    let found1030 = false;
                    
                    // 10:30 시간 찾기
                    for (let cell of cells) {
                        const text = cell.textContent.trim();
                        if (text.includes('10:30') || text.includes('10시30분')) {
                            found1030 = true;
                            break;
                        }
                    }
                    
                    if (found1030) {
                        // 같은 행에서 예약 상태 확인
                        const rowText = row.textContent;
                        
                        // 예약하기 버튼 찾기
                        const reserveLink = row.querySelector('a');
                        if (reserveLink) {
                            const linkText = reserveLink.textContent.trim();
                            
                            if (linkText === '예약하기') {
                                // 일반 예약 가능
                                return {
                                    found: true,
                                    type: 'normal',
                                    canBook: true,
                                    message: '예약하기 가능'
                                };
                            } else if (linkText === '대기예약' || linkText.includes('대기')) {
                                // 대기예약만 가능
                                return {
                                    found: true,
                                    type: 'waiting',
                                    canBook: true,
                                    message: '대기예약만 가능 (정원 초과)'
                                };
                            }
                        }
                        
                        // 기타 상태 확인
                        if (rowText.includes('시간초과')) {
                            return {
                                found: true,
                                type: 'timeout',
                                canBook: false,
                                message: '시간초과 (9:30 이전)'
                            };
                        } else if (rowText.includes('삭제') || rowText.includes('취소')) {
                            return {
                                found: true,
                                type: 'already',
                                canBook: false,
                                message: '이미 예약됨'
                            };
                        }
                        
                        return {
                            found: true,
                            type: 'unknown',
                            canBook: false,
                            message: '예약 불가 상태'
                        };
                    }
                }
                
                return {
                    found: false,
                    canBook: false,
                    message: '10:30 수업을 찾을 수 없음'
                };
            });
            
            await this.log(`🔍 검색 결과: ${result.message}`);
            
            if (!result.found) {
                return { found: false, booked: false };
            }
            
            if (!result.canBook) {
                await this.log(`⚠️ 예약 불가: ${result.message}`);
                return { found: true, booked: false, message: result.message };
            }
            
            // 테스트 모드면 여기서 종료
            if (this.testMode) {
                await this.log('✅ 테스트 모드 - 실제 예약하지 않음');
                return { 
                    found: true, 
                    booked: false, 
                    type: result.type,
                    message: `테스트: ${result.message}`
                };
            }
            
            // 실제 예약 진행
            if (result.type === 'normal') {
                // 일반 예약
                await this.log('📝 일반 예약 진행...');
                
                // 예약하기 클릭
                await page.evaluate(() => {
                    const links = document.querySelectorAll('a');
                    for (let link of links) {
                        if (link.textContent.trim() === '예약하기') {
                            // 10:30 행에 있는 것인지 확인
                            const row = link.closest('tr');
                            if (row && row.textContent.includes('10:30')) {
                                link.click();
                                return true;
                            }
                        }
                    }
                    return false;
                });
                
                await page.waitForTimeout(1000);
                
                // Submit 버튼 클릭
                const submitClicked = await page.evaluate(() => {
                    const buttons = document.querySelectorAll('button, input[type="submit"]');
                    for (let btn of buttons) {
                        const text = (btn.textContent || btn.value || '').trim();
                        if (text === 'Submit' || text.includes('예약') || text === '확인') {
                            btn.click();
                            return true;
                        }
                    }
                    return false;
                });
                
                if (submitClicked) {
                    await this.log('✅ Submit 완료');
                    await page.waitForTimeout(2000);
                    await this.takeScreenshot(page, '06-reservation-complete');
                }
                
                return { 
                    found: true, 
                    booked: true, 
                    type: 'normal',
                    message: '일반 예약 완료'
                };
                
            } else if (result.type === 'waiting') {
                // 대기예약
                await this.log('📝 대기예약 진행...');
                
                // 대기예약 클릭
                await page.evaluate(() => {
                    const links = document.querySelectorAll('a');
                    for (let link of links) {
                        const text = link.textContent.trim();
                        if (text === '대기예약' || text.includes('대기')) {
                            // 10:30 행에 있는 것인지 확인
                            const row = link.closest('tr');
                            if (row && row.textContent.includes('10:30')) {
                                link.click();
                                return true;
                            }
                        }
                    }
                    return false;
                });
                
                // confirm 팝업 처리는 dialog 이벤트 핸들러에서 자동 처리됨
                await page.waitForTimeout(1500);
                
                // Submit 버튼 클릭
                const submitClicked = await page.evaluate(() => {
                    const buttons = document.querySelectorAll('button, input[type="submit"]');
                    for (let btn of buttons) {
                        const text = (btn.textContent || btn.value || '').trim();
                        if (text === 'Submit' || text.includes('예약') || text === '확인') {
                            btn.click();
                            return true;
                        }
                    }
                    return false;
                });
                
                if (submitClicked) {
                    await this.log('✅ 대기예약 Submit 완료');
                    await page.waitForTimeout(2000);
                    await this.takeScreenshot(page, '07-waiting-complete');
                }
                
                return { 
                    found: true, 
                    booked: true, 
                    type: 'waiting',
                    message: '대기예약 완료 (*표시)'
                };
            }
            
        } catch (error) {
            await this.log(`❌ 예약 과정 에러: ${error.message}`);
            await this.takeScreenshot(page, 'error-booking');
            throw error;
        }
    }

    async verifyBooking(page, bookingType) {
        await this.log('🔍 예약 확인 중...');
        
        try {
            // 캘린더로 돌아가기
            await page.goto(`${this.baseUrl}/yeapp/yeapp.php?tm=102`, {
                waitUntil: 'networkidle2'
            });
            
            await page.waitForTimeout(2000);
            
            // 예약 확인 (대기예약은 * 표시, 일반예약은 숫자 변화)
            const targetDate = new Date();
            targetDate.setDate(targetDate.getDate() + 7);
            const day = targetDate.getDate();
            
            const verificationResult = await page.evaluate((targetDay, type) => {
                const cells = document.querySelectorAll('td');
                for (let cell of cells) {
                    const text = cell.textContent.trim();
                    if (text.includes(String(targetDay))) {
                        if (type === 'waiting' && text.includes('*')) {
                            return { verified: true, message: '대기예약 확인 (*표시)' };
                        } else if (type === 'normal' && !text.includes('X')) {
                            return { verified: true, message: '일반예약 확인' };
                        }
                    }
                }
                return { verified: false, message: '예약 확인 실패' };
            }, day, bookingType);
            
            await this.log(verificationResult.message);
            await this.takeScreenshot(page, '08-verification');
            
            return verificationResult.verified;
            
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
        let bookingResult = null;
        
        while (retryCount < this.maxRetries && !success) {
            const browser = await puppeteer.launch({
                headless: process.env.HEADLESS !== 'false' ? 'new' : false,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--window-size=1920,1080',
                    '--lang=ko-KR'
                ]
            });
            
            try {
                const page = await browser.newPage();
                
                // 설정
                page.setDefaultTimeout(30000);
                await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
                await page.setViewport({ width: 1920, height: 1080 });
                
                // 인코딩 설정
                await page.setExtraHTTPHeaders({
                    'Accept-Language': 'ko-KR,ko;q=0.9',
                    'Accept-Charset': 'UTF-8'
                });
                
                // Dialog 처리 (대기예약 confirm 처리 - 세션 1 핵심)
                page.on('dialog', async dialog => {
                    const message = dialog.message();
                    await this.log(`📢 팝업 메시지: ${message}`);
                    
                    // 대기예약 confirm 처리
                    if (message.includes('대기예약') || message.includes('정원이 초과')) {
                        await this.log('✅ 대기예약 확인 팝업 - 수락');
                        await dialog.accept();
                    } else if (message.includes('예약') && message.includes('완료')) {
                        await this.log('✅ 예약 완료 팝업');
                        await dialog.accept();
                        success = true;
                    } else {
                        await dialog.accept();
                    }
                });
                
                // 콘솔 로그 캡처
                page.on('console', msg => {
                    if (msg.type() === 'log') {
                        this.log(`[브라우저]: ${msg.text()}`);
                    }
                });
                
                // 1. 로그인
                await this.login(page);
                
                // 2. 예약 페이지로 이동 및 날짜 선택
                const dateInfo = await this.navigateToBookingPage(page);
                
                // 3. 10:30 수업 찾고 예약
                bookingResult = await this.find1030ClassAndBook(page);
                
                // 4. 예약 확인
                if (!this.testMode && bookingResult.booked) {
                    const verified = await this.verifyBooking(page, bookingResult.type);
                    if (verified) {
                        success = true;
                    }
                } else if (this.testMode && bookingResult.found) {
                    success = true;
                }
                
                if (success || (bookingResult && bookingResult.booked)) {
                    await this.log('🎉🎉🎉 예약 프로세스 완료! 🎉🎉🎉');
                    
                    // 결과 저장
                    const resultInfo = {
                        timestamp: new Date().toISOString(),
                        date: `${dateInfo.year}-${dateInfo.month}-${dateInfo.day}`,
                        class: '10:30',
                        status: bookingResult.type === 'waiting' ? 'WAITING' : 'SUCCESS',
                        message: bookingResult.message,
                        verified: !this.testMode ? success : null
                    };
                    
                    await fs.writeFile(
                        'booking-result.json',
                        JSON.stringify(resultInfo, null, 2)
                    );
                    
                    if (bookingResult.type === 'waiting') {
                        await this.log('⚠️ 대기예약으로 등록되었습니다. 취소 발생 시 자동 예약됩니다.');
                    }
                    
                    success = true; // 대기예약도 성공으로 처리
                } else if (bookingResult && bookingResult.found && !bookingResult.booked) {
                    await this.log(`⚠️ ${bookingResult.message}`);
                    if (bookingResult.message.includes('이미 예약') || 
                        bookingResult.message.includes('시간초과')) {
                        break; // 재시도 불필요
                    }
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
            
            // 실패 결과 저장
            await fs.writeFile(
                'booking-result.json',
                JSON.stringify({
                    timestamp: new Date().toISOString(),
                    status: 'FAILED',
                    message: bookingResult?.message || '예약 실패',
                    retries: retryCount
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
    process.exit(1);
}

// 실행
const booking = new PilatesBooking();
booking.run().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
