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
        this.retryDelay = 1000;
        
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
            
            // 로그인 페이지로 이동
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
            
            // 로그인 폼 입력
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
                    await page.waitForLoadState('networkidle');
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
            // 테이블 로드 대기
            await page.waitForSelector('table', { timeout: 5000 }).catch(() => {
                this.log('⚠️ 테이블 로드 대기 시간 초과');
            });
            
            await this.takeScreenshot(page, '04-time-table');
            
            // 개선된 10:30 수업 찾기 로직
            const result = await page.evaluate(() => {
                // 1. 올바른 시간표 테이블 찾기
                const tables = document.querySelectorAll('table');
                let timeTable = null;
                
                console.log(`발견된 테이블 수: ${tables.length}`);
                
                // 시간표 테이블 식별 - 여러 조건으로 확인
                for (let table of tables) {
                    const tableText = table.textContent || '';
                    const headers = Array.from(table.querySelectorAll('th, td')).map(el => el.textContent.trim());
                    
                    // 시간표 특징: 수강종목, 수강시간, 예약신청 등의 헤더 포함
                    if ((tableText.includes('수강종목') && tableText.includes('수강시간')) ||
                        (tableText.includes('예약신청') && tableText.includes('시간')) ||
                        (headers.some(h => h === '수강시간' || h === '시간') && 
                         headers.some(h => h === '예약신청' || h === '예약'))) {
                        timeTable = table;
                        console.log('✅ 시간표 테이블 발견');
                        break;
                    }
                }
                
                // 테이블을 못 찾은 경우, 시간 정보가 있는 테이블 찾기
                if (!timeTable) {
                    console.log('⚠️ 명시적 시간표를 찾지 못해 시간 정보가 있는 테이블 검색');
                    for (let table of tables) {
                        const cells = table.querySelectorAll('td');
                        for (let cell of cells) {
                            const text = cell.textContent.trim();
                            // 시간 패턴 확인 (XX:XX 형식)
                            if (/\d{1,2}[:：]\d{2}/.test(text) && !text.includes('script')) {
                                timeTable = table;
                                console.log('✅ 시간 정보가 있는 테이블 발견');
                                break;
                            }
                        }
                        if (timeTable) break;
                    }
                }
                
                if (!timeTable) {
                    return {
                        found: false,
                        message: '시간표 테이블을 찾을 수 없음'
                    };
                }
                
                // 2. 테이블 내에서 10:30 수업 찾기
                const rows = timeTable.querySelectorAll('tr');
                console.log(`검색할 행 수: ${rows.length}`);
                
                // 각 행을 순회하며 10:30 찾기
                for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
                    const row = rows[rowIndex];
                    const cells = row.querySelectorAll('td');
                    
                    // 충분한 열이 있는지 확인 (최소 3개: 종목, 시간, 예약)
                    if (cells.length < 3) continue;
                    
                    // 각 셀을 확인하여 시간 찾기
                    let timeCell = null;
                    let timeCellIndex = -1;
                    
                    for (let i = 0; i < cells.length; i++) {
                        const cellText = cells[i].textContent.trim();
                        
                        // 10:30 패턴 매칭 - 다양한 형식 지원
                        const timePatterns = [
                            /^10[:：]30$/,           // 정확히 10:30
                            /^오전\s*10[:：]30$/,    // 오전 10:30
                            /10[:：]30\s*[-~]/,      // 10:30~
                            /^\d{1,2}[:：]30.*10[:：]30/  // 시작~10:30
                        ];
                        
                        const has1030 = timePatterns.some(pattern => pattern.test(cellText)) ||
                                       (cellText === '10:30') ||
                                       (cellText === '오전 10:30') ||
                                       (cellText.includes('10:30') && !cellText.includes('09:30'));
                        
                        if (has1030) {
                            timeCell = cells[i];
                            timeCellIndex = i;
                            console.log(`🎯 10:30 수업 발견! 행: ${rowIndex}, 열: ${i}, 내용: ${cellText}`);
                            break;
                        }
                    }
                    
                    // 10:30 수업을 찾은 경우
                    if (timeCell) {
                        // 같은 행에서 예약 버튼 찾기 (보통 시간 열 다음이나 마지막 열)
                        let actionCell = null;
                        
                        // 1. 시간 열 바로 다음 확인
                        if (timeCellIndex < cells.length - 1) {
                            actionCell = cells[timeCellIndex + 1];
                        }
                        
                        // 2. 마지막 열 확인
                        if (!actionCell || !actionCell.textContent.trim()) {
                            actionCell = cells[cells.length - 1];
                        }
                        
                        // 3. 예약 관련 텍스트가 있는 열 찾기
                        if (!actionCell || !actionCell.textContent.trim()) {
                            for (let j = 0; j < cells.length; j++) {
                                const text = cells[j].textContent.trim();
                                if (text.includes('예약') || text.includes('대기') || text.includes('삭제')) {
                                    actionCell = cells[j];
                                    break;
                                }
                            }
                        }
                        
                        if (actionCell) {
                            const actionText = actionCell.textContent.trim();
                            console.log(`예약 셀 내용: ${actionText}`);
                            
                            // 예약하기 처리
                            if (actionText.includes('예약하기') || actionText === '예약하기') {
                                const link = actionCell.querySelector('a');
                                if (link) {
                                    const onclickAttr = link.getAttribute('onclick');
                                    console.log('예약하기 onclick:', onclickAttr);
                                    
                                    if (onclickAttr) {
                                        try {
                                            eval(onclickAttr);
                                            return {
                                                found: true,
                                                booked: true,
                                                message: '10:30 수업 예약 성공',
                                                needSubmit: false
                                            };
                                        } catch(e) {
                                            link.click();
                                            return {
                                                found: true,
                                                booked: true,
                                                message: '10:30 수업 예약 클릭',
                                                needSubmit: true
                                            };
                                        }
                                    } else {
                                        link.click();
                                        return {
                                            found: true,
                                            booked: true,
                                            message: '10:30 수업 예약 클릭',
                                            needSubmit: true
                                        };
                                    }
                                }
                            }
                            
                            // 대기예약 처리
                            else if (actionText.includes('대기')) {
                                const link = actionCell.querySelector('a');
                                if (link) {
                                    const onclickAttr = link.getAttribute('onclick');
                                    console.log('대기예약 onclick:', onclickAttr);
                                    
                                    if (onclickAttr) {
                                        try {
                                            eval(onclickAttr);
                                            return {
                                                found: true,
                                                booked: true,
                                                message: '10:30 수업 대기예약',
                                                isWaitingOnly: true,
                                                needSubmit: false
                                            };
                                        } catch(e) {
                                            link.click();
                                            return {
                                                found: true,
                                                booked: true,
                                                message: '10:30 수업 대기예약 클릭',
                                                isWaitingOnly: true,
                                                needSubmit: true
                                            };
                                        }
                                    } else {
                                        link.click();
                                        return {
                                            found: true,
                                            booked: true,
                                            message: '10:30 수업 대기예약',
                                            isWaitingOnly: true,
                                            needSubmit: true
                                        };
                                    }
                                }
                            }
                            
                            // 이미 예약됨
                            else if (actionText.includes('삭제') || actionText.includes('취소')) {
                                return {
                                    found: true,
                                    booked: false,
                                    message: '10:30 수업은 이미 예약되어 있음'
                                };
                            }
                            
                            // 예약 마감
                            else {
                                return {
                                    found: true,
                                    booked: false,
                                    message: `10:30 수업 예약 불가 (상태: ${actionText})`
                                };
                            }
                        }
                    }
                }
                
                // 10:30 수업을 찾지 못한 경우
                return {
                    found: false,
                    booked: false,
                    message: '10:30 수업을 찾을 수 없음'
                };
            });
            
            await this.log(`🔍 검색 결과: ${result.message}`);
            
            // onclick으로 처리된 경우 페이지 변화 대기
            if (result.booked && !result.needSubmit) {
                await this.log('⏳ 예약 처리 대기 중...');
                await page.waitForTimeout(3000);
                
                // 알림 또는 페이지 이동 확인
                const currentUrl = page.url();
                await this.log(`📍 현재 URL: ${currentUrl}`);
                
                // 예약 성공 메시지 확인
                const successMessage = await page.evaluate(() => {
                    const bodyText = document.body.innerText;
                    if (bodyText.includes('예약완료') || 
                        bodyText.includes('예약 완료') ||
                        bodyText.includes('예약이 완료') ||
                        bodyText.includes('대기예약 완료')) {
                        return true;
                    }
                    return false;
                });
                
                if (successMessage) {
                    await this.log('✅ 예약 완료 메시지 확인!');
                    await this.takeScreenshot(page, '07-booking-complete');
                }
            }
            
            // Submit이 필요한 경우
            if (!this.testMode && result.booked && result.needSubmit) {
                await this.log('📝 Submit 처리 중...');
                await page.waitForTimeout(1000);
                
                // Submit 버튼 찾기
                const submitSuccess = await page.evaluate(() => {
                    const submitButtons = document.querySelectorAll(
                        'button[type="submit"], ' +
                        'input[type="submit"], ' +
                        'input[type="image"], ' +
                        'button:not([type]), ' +
                        'input[value*="예약"], ' +
                        'button'
                    );
                    
                    for (let btn of submitButtons) {
                        const text = btn.textContent || btn.value || '';
                        if (text.includes('예약') || text.includes('확인') || text.includes('등록')) {
                            console.log('Submit 버튼 발견:', text);
                            btn.click();
                            return true;
                        }
                    }
                    
                    // form submit 시도
                    const forms = document.querySelectorAll('form');
                    for (let form of forms) {
                        if (form.action && form.action.includes('res')) {
                            console.log('Form submit:', form.action);
                            form.submit();
                            return true;
                        }
                    }
                    
                    return false;
                });
                
                if (submitSuccess) {
                    await this.log('✅ Submit 완료!');
                    await page.waitForTimeout(2000);
                    await this.takeScreenshot(page, '06-after-submit');
                } else {
                    await this.log('⚠️ Submit 버튼을 찾을 수 없음');
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
