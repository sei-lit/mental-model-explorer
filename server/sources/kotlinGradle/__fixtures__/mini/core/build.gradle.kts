plugins {
    id("usapo.primitive.kmp")
}

kotlin {
    sourceSets {
        commonMain.dependencies {
            implementation(projects.tools.gen)
        }
    }
}
