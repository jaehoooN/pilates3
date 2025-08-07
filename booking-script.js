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
        
        // 10:30 수업 찾기 - 유연한 검색
        const result = await page.evaluate(() => {
            // 모든 테이블 찾기 (여러 테이블이 있을 수 있음)
            const tables = document.querySelectorAll('table');
            
            // 각 테이블에서 10:30 찾기
            for (let table of tables) {
                const rows = table.querySelectorAll('tr');
                
                // 각 행 검사
                for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
                    const row = rows[rowIndex];
                    const cells = row.querySelectorAll('td');
                    
                    // 빈 행 스킵
                    if (cells.length < 2) continue;
                    
                    // 현재 행에 10:30이 있는지 확인
                    let has1030 = false;
                    let timeColumnIndex = -1;
                    
                    for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
                        const cellText = cells[cellIndex].textContent.trim();
                        
                        // 다양한 10:30 표현 매칭
                        if (
                            cellText === '오전 10:30' ||
                            cellText === '10:30' ||
                            cellText === '오전10:30' ||
                            cellText === 'AM 10:30' ||
                            cellText === '10시30분' ||
                            cellText === '오전 10시 30분' ||
                            (cellText.includes('10') && cellText.includes('30') && !cellText.includes('09:30'))
                        ) {
                            // 09:30, 11:30 등 다른 시간 제외
                            if (cellText.includes('09:30') || 
                                cellText.includes('11:30') || 
                                cellText.includes('10:00')) {
                                continue;
                            }
                            
                            has1030 = true;
                            timeColumnIndex = cellIndex;
                            console.log(`✅ 10:30 발견! 행: ${rowIndex + 1}, 열: ${cellIndex + 1}`);
                            console.log('시간 텍스트:', cellText);
                            break;
                        }
                    }
                    
                    // 10:30을 찾았으면 해당 행 처리
                    if (has1030) {
                        console.log(`행 ${rowIndex + 1} 처리 중...`);
                        console.log('행 내용 미리보기:', row.textContent.substring(0, 100) + '...');
                        
                        // 수업 정보 추출 (수업명, 강사명, 정원)
                        let courseInfo = {
                            name: '',
                            instructor: '',
                            current: 0,
                            max: 0,
                            isFull: false
                        };
                        
                        // 수업 정보 찾기 (보통 시간 앞이나 뒤 컬럼)
                        for (let j = 0; j < cells.length; j++) {
                            const text = cells[j].textContent.trim();
                            
                            // 정원 정보 추출 (예: "(4/8)", "(8/8)")
                            const capacityMatch = text.match(/\((\d+)\/(\d+)\)/);
                            if (capacityMatch) {
                                courseInfo.current = parseInt(capacityMatch[1]);
                                courseInfo.max = parseInt(capacityMatch[2]);
                                courseInfo.isFull = courseInfo.current >= courseInfo.max;
                                
                                // 수업명과 강사명 추출
                                // "바렐 체어(승정쌤)(4/8)" 형태
                                const nameMatch = text.match(/^([^(]+)(?:\(([^)]+)\))?\(/);
                                if (nameMatch) {
                                    courseInfo.name = nameMatch[1].trim();
                                    courseInfo.instructor = nameMatch[2] || '';
                                }
                                
                                console.log(`수업: ${courseInfo.name}, 강사: ${courseInfo.instructor}, 정원: ${courseInfo.current}/${courseInfo.max}`);
                                break;
                            }
                        }
                        
                        // 버튼/링크 찾기
                        const actionElements = row.querySelectorAll('a, button, input[type="button"], input[type="submit"]');
                        console.log(`액션 요소 ${actionElements.length}개 발견`);
                        
                        // 버튼 처리
                        for (let elem of actionElements) {
                            const buttonText = (elem.textContent || elem.value || '').trim();
                            const onclick = elem.getAttribute('onclick') || '';
                            
                            console.log(`버튼: "${buttonText}", onclick: "${onclick}"`);
                            
                            // 케이스 1: 예약하기 (정원 여유)
                            if (buttonText === '예약하기' || buttonText.includes('예약하기')) {
                                console.log('✅ 예약하기 버튼 클릭!');
                                
                                // onclick에 inltxt가 있으면 먼저 실행
                                if (onclick.includes('inltxt')) {
                                    try {
                                        eval(onclick);
                                        console.log('inltxt 함수 실행됨');
                                    } catch(e) {
                                        console.log('inltxt 실행 실패:', e);
                                    }
                                }
                                
                                elem.click();
                                return {
                                    found: true,
                                    booked: true,
                                    message: `10:30 ${courseInfo.name || '수업'} 예약하기 클릭`,
                                    type: 'normal',
                                    courseInfo: courseInfo
                                };
                            }
                            
                            // 케이스 2: 대기예약 (정원 초과)
                            else if (buttonText === '대기예약' || buttonText.includes('대기')) {
                                console.log('⚠️ 대기예약 버튼 클릭!');
                                elem.click();
                                return {
                                    found: true,
                                    booked: true,
                                    message: `10:30 ${courseInfo.name || '수업'} 대기예약 클릭`,
                                    type: 'waiting',
                                    courseInfo: courseInfo
                                };
                            }
                            
                            // 케이스 3: 삭제/취소 (이미 예약됨)
                            else if (buttonText === '삭제' || buttonText === '취소' || buttonText.includes('삭제')) {
                                return {
                                    found: true,
                                    booked: false,
                                    message: `10:30 ${courseInfo.name || '수업'} 이미 예약됨`,
                                    type: 'already',
                                    courseInfo: courseInfo
                                };
                            }
                        }
                        
                        // 버튼이 없지만 정원 초과인 경우
                        if (courseInfo.isFull && actionElements.length === 0) {
                            console.log('정원 초과, 대기예약 방법 찾기...');
                            
                            // 체크박스 확인
                            const checkbox = row.querySelector('input[type="checkbox"]');
                            if (checkbox) {
                                checkbox.checked = true;
                                checkbox.click();
                                console.log('체크박스 선택');
                                
                                return {
                                    found: true,
                                    booked: true,
                                    message: `10:30 ${courseInfo.name || '수업'} 대기예약 준비`,
                                    type: 'waiting',
                                    needWaitingProcess: true,
                                    courseInfo: courseInfo
                                };
                            }
                        }
                        
                        // 예약 불가
                        return {
                            found: true,
                            booked: false,
                            message: `10:30 ${courseInfo.name || '수업'} 예약 불가`,
                            courseInfo: courseInfo
                        };
                    }
                }
            }
            
            // 10:30을 못 찾은 경우 - 디버깅 정보
            console.log('❌ 10:30 수업을 찾을 수 없음');
            
            // 모든 시간 수집 (디버깅용)
            const allTimes = [];
            document.querySelectorAll('td').forEach(cell => {
                const text = cell.textContent.trim();
                if (text.match(/\d{1,2}:\d{2}/) || text.includes('오전') || text.includes('오후')) {
                    if (text.length < 20) { // 너무 긴 텍스트 제외
                        allTimes.push(text);
                    }
                }
            });
            
            console.log('페이지의 모든 시간:', allTimes.join(', '));
            
            return {
                found: false,
                booked: false,
                message: '10:30 수업을 찾을 수 없음',
                debugInfo: allTimes
            };
        });
        
        // 결과 로깅
        await this.log(`🔍 검색 결과: ${result.message}`);
        
        if (result.courseInfo) {
            const info = result.courseInfo;
            await this.log(`📚 수업 상세: ${info.name} ${info.instructor ? `(${info.instructor})` : ''} [${info.current}/${info.max}]`);
        }
        
        if (result.debugInfo && result.debugInfo.length > 0) {
            await this.log(`🔍 페이지의 시간들: ${result.debugInfo.slice(0, 10).join(', ')}`);
        }
        
        // 대기예약 후처리
        if (result.needWaitingProcess && !this.testMode) {
            await this.log('⏳ 대기예약 프로세스 진행...');
            await page.waitForTimeout(1000);
            
            const processed = await page.evaluate(() => {
                // 다양한 버튼 찾기
                const buttons = document.querySelectorAll('button, input[type="button"], input[type="submit"], a');
                
                for (let btn of buttons) {
                    const text = (btn.textContent || btn.value || '').trim();
                    
                    // 대기예약 관련 버튼
                    if (text === '대기예약' || 
                        text === '목록보기' || 
                        text === '예약하기' ||
                        text === '확인') {
                        console.log(`"${text}" 버튼 클릭!`);
                        btn.click();
                        return text;
                    }
                }
                return false;
            });
            
            if (processed) {
                await this.log(`✅ "${processed}" 버튼 클릭 완료`);
                await page.waitForTimeout(2000);
            }
        }
        
        // 완료 스크린샷
        if (result.booked) {
            await page.waitForTimeout(2000);
            await this.takeScreenshot(page, '05-after-booking');
            
            // 성공 메시지 확인
            const confirmation = await page.evaluate(() => {
                const bodyText = document.body.innerText || '';
                return {
                    success: bodyText.includes('예약완료') || bodyText.includes('예약이 완료'),
                    waiting: bodyText.includes('대기예약') || bodyText.includes('대기 예약')
                };
            });
            
            if (confirmation.success) {
                await this.log('✅ 예약 완료 확인!');
            } else if (confirmation.waiting) {
                await this.log('⚠️ 대기예약 등록 확인!');
            }
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
