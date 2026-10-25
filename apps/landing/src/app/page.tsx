import Link from "next/link";
import styles from "./page.module.css";

export default function Home() {
    return (
        <main className={styles.page}>
            <div className={styles.teamWash} aria-hidden="true" />
            <nav className={styles.nav}>
                <Link className={styles.brand} href="/">
                    <span className={styles.blueText}>SKILL</span><span className={styles.redText}>ISSUE</span>
                </Link>
                <div className={styles.navLinks}>
                    <a href="#rules">THE MATCH</a>
                    <a href="#leaderboard">STANDINGS</a>
                    <span className={styles.navMark}>2v2 / LIVE ARENA</span>
                </div>
            </nav>

            <section className={styles.hero}>
                <div className={styles.heroCopy}>
                    <p className={styles.eyebrow}>The co-op FPS for questionable decisions</p>
                    <h1>ONE BODY.<br /><span>TWO PLAYERS.</span></h1>
                    <p className={styles.lede}>You do not control a character alone. One teammate moves. One teammate aims. Every bad call is shared.</p>
                    <div className={styles.actions}>
                        <a className={styles.primaryButton} href="#rules">LEARN THE RULES</a>
                        <a className={styles.secondaryButton} href="#match-loop">SEE THE LOOP</a>
                    </div>
                    <div className={styles.heroMeta}><span><i className={styles.readyDot} /> 2v2 CO-OP FPS</span><span>FIRST TO 10</span><span>ONE HEALTH BAR</span></div>
                </div>
                <div className={styles.arena} aria-label="Blue and red team arena preview">
                    <div className={styles.arenaGrid} />
                    <div className={styles.arenaHorizon} />
                    <div className={styles.arenaSplit} />
                    <div className={styles.arenaCrosshair}><span /><span /></div>
                    <div className={`${styles.fighter} ${styles.blueFighter}`}>
                        <div className={styles.fighterHead} />
                        <div className={styles.fighterBody} />
                        <div className={styles.fighterArm} />
                    </div>
                    <div className={`${styles.fighter} ${styles.redFighter}`}>
                        <div className={styles.fighterHead} />
                        <div className={styles.fighterBody} />
                        <div className={styles.fighterArm} />
                    </div>
                    <div className={`${styles.teamBadge} ${styles.badgeBlue}`}><b>BLUE</b><span>MOVE</span></div>
                    <div className={`${styles.teamBadge} ${styles.badgeRed}`}><b>RED</b><span>AIM</span></div>
                    <div className={styles.arenaCode}>MATCH / 02<br /><strong>READY</strong></div>
                </div>
            </section>

            <section className={styles.sharedBody}>
                <div className={styles.sharedCopy}><p className={styles.eyebrow}>The premise</p><h2>YOUR TEAM<br />HAS <span>ONE BODY.</span></h2><p>Skill Issue turns communication into a control scheme. Your teammate is not beside you on a screen; they are the other half of your movement, aim, and escape.</p></div>
                <div className={styles.sharedStats}><div><strong>02</strong><span>PLAYERS<br />PER BODY</span></div><div><strong>01</strong><span>SHARED<br />HEALTH BAR</span></div><div><strong>10</strong><span>KILLS TO<br />TAKE IT</span></div></div>
            </section>

            <section className={styles.rules} id="rules">
                <div className={styles.sectionIntro}><p className={styles.eyebrow}>Pick your half</p><h2>BUILT FOR<br /><span>CALL-OUTS.</span></h2><p>There is no spectator role. Both phones are always making the next decision.</p></div>
                <div className={styles.ruleGrid}>
                    <article className={`${styles.ruleCard} ${styles.blueCard}`}><span className={styles.cardNumber}>01 / BLUE</span><h3>MOVE</h3><p>Tilt and flick your phone to move, jump, crouch, and sprint through the arena.</p><strong>THE MOVEMENT PHONE</strong><div className={styles.cardSignal}>PITCH / YAW / FLICK</div></article>
                    <article className={`${styles.ruleCard} ${styles.redCard}`}><span className={styles.cardNumber}>02 / RED</span><h3>AIM</h3><p>Turn, jab, reload, and choose the right weapon while your partner finds the angle.</p><strong>THE GUNNER PHONE</strong><div className={styles.cardSignal}>TURN / SHOOT / SWITCH</div></article>
                    <article className={`${styles.ruleCard} ${styles.goldCard}`}><span className={styles.cardNumber}>03 / BOTH</span><h3>WIN</h3><p>First team to ten eliminations takes the match. Celebrate loudly. Blame the call-out.</p><strong>THE SHARED SCREEN</strong><div className={styles.cardSignal}>CALL / COMMIT / CLUTCH</div></article>
                </div>
            </section>

            <section className={styles.matchLoop} id="match-loop">
                <div className={styles.loopHeader}><p className={styles.eyebrow}>How a round feels</p><h2>CALL IT.<br /><span>MOVE IT.</span><br />TAKE THE SHOT.</h2></div>
                <div className={styles.loopRail}>
                    <div className={styles.loopStep}><span>01</span><b>CALL</b><p>“Left side.”<br />“Push now.”<br />“Reloading.”</p></div>
                    <div className={styles.loopStep}><span>02</span><b>COMMIT</b><p>One phone tilts.<br />One phone turns.<br />The body moves.</p></div>
                    <div className={styles.loopStep}><span>03</span><b>CLUTCH</b><p>One health bar.<br />One last angle.<br />Ten kills.</p></div>
                </div>
            </section>

            <footer className={styles.footer}><span><span className={styles.blueText}>SKILL</span><span className={styles.redText}>ISSUE</span> / HackPSU Fall 2026</span><span>&copy; 2026 Aditya Pratap Singh, Brian Podolskiy, Kenneth Tran, Michael Shepherd, Ryan Smith</span></footer>
        </main>
    );
}
